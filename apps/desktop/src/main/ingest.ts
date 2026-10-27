import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  activityPayloadSchema,
  type ActivityPayload,
} from "@studio/shared";

export interface IngestOptions {
  preferredPort: number;
  version: string;
  getToken: () => string;
  onActivity: (payload: ActivityPayload) => void;
  onPortChange: (port: number) => void;
  onError: (message: string) => void;
}

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_PER_SECOND = 12;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export class IngestServer {
  private server: Server | null = null;
  private port = 0;
  private hits: number[] = [];

  constructor(private readonly opts: IngestOptions) {}

  getPort(): number {
    return this.port;
  }

  getUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<number> {
    const preferred = this.opts.preferredPort;
    let lastError: unknown = null;

    for (let port = preferred; port < preferred + 10; port++) {
      try {
        await this.listen(port);
        this.port = port;
        this.opts.onPortChange(port);
        return port;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EADDRINUSE") break;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Could not start the local ingest server");
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res);
      });
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        this.server = server;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private allowHit(): boolean {
    const now = Date.now();
    this.hits = this.hits.filter((time) => now - time < 1000);
    if (this.hits.length >= RATE_LIMIT_PER_SECOND) return false;
    this.hits.push(now);
    return true;
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        app: "studio-presence",
        version: this.opts.version,
        port: this.port,
      });
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/ingest") {
      json(res, 404, { error: "not_found" });
      return;
    }

    if (!this.allowHit()) {
      json(res, 429, { error: "rate_limited" });
      return;
    }

    const expected = `Bearer ${this.opts.getToken()}`;
    if (!safeEqual(req.headers.authorization ?? "", expected)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req, MAX_BODY_BYTES);
    } catch (error) {
      const message = error instanceof Error ? error.message : "bad_request";
      json(res, message === "payload_too_large" ? 413 : 400, {
        error: message,
      });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      json(res, 400, { error: "invalid_json" });
      return;
    }

    const parsed = activityPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) {
      json(res, 400, {
        error: "invalid_payload",
        issues: parsed.error.issues.slice(0, 8).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    try {
      this.opts.onActivity(parsed.data);
    } catch (error) {
      this.opts.onError(
        error instanceof Error ? error.message : "activity handler failed",
      );
      json(res, 500, { error: "internal_error" });
      return;
    }

    json(res, 200, { ok: true });
  }
}
