import { app } from "electron";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DEFAULT_DISCORD_APP_ID, type AppSettings } from "@beacon/shared";

export const DEFAULT_INGEST_PORT = 47831;

const DEFAULT_SETTINGS: AppSettings = {
  autoStart: true,
  rpcEnabled: true,
  privateMode: false,
  largeImageKey: process.env.STUDIO_BEACON_LARGE_IMAGE_KEY ?? "",
  idleSeconds: 300,
};

interface StoredConfig {
  version: 3;
  ingestPort: number;
  discordAppId: string;
  settings: AppSettings;
  token: string;
}

function newToken(): string {
  return `sp_${randomBytes(24).toString("hex")}`;
}

function envPort(): number {
  const raw = Number(process.env.STUDIO_BEACON_INGEST_PORT);
  return Number.isInteger(raw) && raw >= 1024 && raw <= 65535
    ? raw
    : DEFAULT_INGEST_PORT;
}

export class ConfigStore {
  private readonly file: string;
  private data: StoredConfig;

  constructor() {
    this.file = path.join(app.getPath("userData"), "config.json");
    this.data = this.read();
    if (!this.data.token) this.data.token = newToken();
    // Always persist on boot so the token is stable across restarts.
    this.save();
  }

  private defaults(): StoredConfig {
    return {
      version: 3,
      ingestPort: envPort(),
      discordAppId:
        process.env.STUDIO_BEACON_DISCORD_APP_ID ?? DEFAULT_DISCORD_APP_ID,
      settings: { ...DEFAULT_SETTINGS },
      token: newToken(),
    };
  }

  private read(): StoredConfig {
    const defaults = this.defaults();
    if (!existsSync(this.file)) return defaults;

    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Record<
        string,
        unknown
      >;
      const storedSettings = (raw.settings ?? {}) as Partial<AppSettings>;
      const settings = { ...defaults.settings, ...storedSettings };

      const version = typeof raw.version === "number" ? raw.version : 1;
      const storedAppId =
        typeof raw.discordAppId === "string" ? raw.discordAppId.trim() : "";

      return {
        version: 3,
        ingestPort:
          Number.isInteger(raw.ingestPort) &&
          (raw.ingestPort as number) >= 1024 &&
          (raw.ingestPort as number) <= 65535
            ? (raw.ingestPort as number)
            : defaults.ingestPort,
        // Before v3 the app had no default ID, so an empty value there means
        // "not configured yet" and gets the shared application. From v3 on an
        // empty string is an intentional choice (presence disabled).
        discordAppId:
          storedAppId || (version >= 3 ? "" : defaults.discordAppId),
        settings: {
          autoStart:
            typeof settings.autoStart === "boolean"
              ? settings.autoStart
              : defaults.settings.autoStart,
          rpcEnabled:
            typeof settings.rpcEnabled === "boolean"
              ? settings.rpcEnabled
              : defaults.settings.rpcEnabled,
          privateMode:
            typeof settings.privateMode === "boolean"
              ? settings.privateMode
              : defaults.settings.privateMode,
          largeImageKey:
            typeof settings.largeImageKey === "string"
              ? settings.largeImageKey.slice(0, 64) ||
                (version >= 3 ? "" : defaults.settings.largeImageKey)
              : defaults.settings.largeImageKey,
          idleSeconds:
            Number.isInteger(settings.idleSeconds) &&
            (settings.idleSeconds as number) >= 30 &&
            (settings.idleSeconds as number) <= 3600
              ? (settings.idleSeconds as number)
              : defaults.settings.idleSeconds,
        },
        token: typeof raw.token === "string" ? raw.token : "",
      };
    } catch {
      return defaults;
    }
  }

  private save(): void {
    const dir = path.dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // Best effort on platforms without POSIX permissions.
    }
  }

  getToken(): string {
    // Dev-only escape hatch so automated tests can post to the local server.
    if (process.env.STUDIO_BEACON_DEV_TOKEN) {
      return process.env.STUDIO_BEACON_DEV_TOKEN;
    }
    return this.data.token;
  }

  regenerateToken(): string {
    this.data.token = newToken();
    this.save();
    return this.data.token;
  }

  getSettings(): AppSettings {
    return { ...this.data.settings };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    if (typeof patch.autoStart === "boolean") {
      this.data.settings.autoStart = patch.autoStart;
    }
    if (typeof patch.rpcEnabled === "boolean") {
      this.data.settings.rpcEnabled = patch.rpcEnabled;
    }
    if (typeof patch.privateMode === "boolean") {
      this.data.settings.privateMode = patch.privateMode;
    }
    if (typeof patch.largeImageKey === "string") {
      this.data.settings.largeImageKey = patch.largeImageKey.slice(0, 64);
    }
    if (
      typeof patch.idleSeconds === "number" &&
      Number.isInteger(patch.idleSeconds) &&
      patch.idleSeconds >= 30 &&
      patch.idleSeconds <= 3600
    ) {
      this.data.settings.idleSeconds = patch.idleSeconds;
    }
    this.save();
    return this.getSettings();
  }

  getDiscordAppId(): string {
    return this.data.discordAppId;
  }

  setDiscordAppId(value: string): void {
    this.data.discordAppId = value.trim();
    this.save();
  }

  getIngestPort(): number {
    return this.data.ingestPort;
  }

  setIngestPort(port: number): void {
    this.data.ingestPort = port;
    this.save();
  }
}
