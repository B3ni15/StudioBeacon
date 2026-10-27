import { app, safeStorage } from "electron";
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
import type { AppSettings } from "@studio/shared";

export const DEFAULT_INGEST_PORT = 47831;

const DEFAULT_SETTINGS: AppSettings = {
  autoStart: true,
  rpcEnabled: true,
  privateMode: false,
  largeImageKey: process.env.STUDIO_PRESENCE_LARGE_IMAGE_KEY ?? "",
  idleSeconds: 300,
};

interface StoredConfig {
  version: 1;
  ingestPort: number;
  discordAppId: string;
  settings: AppSettings;
  tokenCipher: string | null;
  tokenPlain: string | null;
}

function newToken(): string {
  return `sp_${randomBytes(24).toString("hex")}`;
}

function envPort(): number {
  const raw = Number(process.env.STUDIO_PRESENCE_INGEST_PORT);
  return Number.isInteger(raw) && raw >= 1024 && raw <= 65535
    ? raw
    : DEFAULT_INGEST_PORT;
}

export class ConfigStore {
  private readonly file: string;
  private data: StoredConfig;
  readonly encryptionAvailable: boolean;

  constructor() {
    this.file = path.join(app.getPath("userData"), "config.json");
    this.encryptionAvailable = this.checkEncryption();
    this.data = this.read();
    this.ensureToken();
    this.save();
  }

  private checkEncryption(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private defaults(): StoredConfig {
    return {
      version: 1,
      ingestPort: envPort(),
      discordAppId: process.env.STUDIO_PRESENCE_DISCORD_APP_ID ?? "",
      settings: { ...DEFAULT_SETTINGS },
      tokenCipher: null,
      tokenPlain: null,
    };
  }

  private read(): StoredConfig {
    const defaults = this.defaults();
    if (!existsSync(this.file)) return defaults;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoredConfig>;
      const settings = { ...defaults.settings, ...(raw.settings ?? {}) };
      return {
        version: 1,
        ingestPort:
          Number.isInteger(raw.ingestPort) &&
          (raw.ingestPort ?? 0) >= 1024 &&
          (raw.ingestPort ?? 0) <= 65535
            ? (raw.ingestPort as number)
            : defaults.ingestPort,
        discordAppId:
          typeof raw.discordAppId === "string"
            ? raw.discordAppId
            : defaults.discordAppId,
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
              ? settings.largeImageKey
              : defaults.settings.largeImageKey,
          idleSeconds:
            Number.isInteger(settings.idleSeconds) &&
            settings.idleSeconds >= 30 &&
            settings.idleSeconds <= 3600
              ? settings.idleSeconds
              : defaults.settings.idleSeconds,
        },
        tokenCipher:
          typeof raw.tokenCipher === "string" ? raw.tokenCipher : null,
        tokenPlain: typeof raw.tokenPlain === "string" ? raw.tokenPlain : null,
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

  private ensureToken(): void {
    if (this.data.tokenCipher || this.data.tokenPlain) return;
    this.writeToken(newToken());
  }

  private writeToken(token: string): void {
    if (this.encryptionAvailable) {
      try {
        this.data.tokenCipher = safeStorage.encryptString(token).toString("base64");
        this.data.tokenPlain = null;
        return;
      } catch {
        // Fall through to plain storage.
      }
    }
    this.data.tokenPlain = token;
    this.data.tokenCipher = null;
  }

  getToken(): string {
    // Dev-only escape hatch so automated tests can post to the local server.
    if (process.env.STUDIO_PRESENCE_DEV_TOKEN) {
      return process.env.STUDIO_PRESENCE_DEV_TOKEN;
    }
    if (this.data.tokenCipher) {
      try {
        return safeStorage.decryptString(
          Buffer.from(this.data.tokenCipher, "base64"),
        );
      } catch {
        // Fall back to a plain token if decryption fails.
      }
    }
    return this.data.tokenPlain ?? "";
  }

  regenerateToken(): string {
    const token = newToken();
    this.writeToken(token);
    this.save();
    return token;
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
