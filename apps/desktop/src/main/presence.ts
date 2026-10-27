import { Client, type SetActivity } from "@xhayper/discord-rpc";
import {
  displayProjectName,
  PLAY_LABELS,
  type ActivityPayload,
  type AppSettings,
  type RpcState,
} from "@beacon/shared";

export interface PresenceOptions {
  getAppId: () => string;
  getSettings: () => AppSettings;
  onChange: () => void;
}

function clampText(value: string, fallback = "Roblox Studio"): string {
  let text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2) text = fallback;
  if (text.length > 128) text = `${text.slice(0, 127)}…`;
  return text;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !message ||
    /ENOENT|ECONNREFUSED|EPIPE|COULD_NOT_FIND_CLIENT|could not connect|pipe/i.test(
      message,
    )
  ) {
    return "Discord is not running";
  }
  return message.length > 180 ? `${message.slice(0, 179)}…` : message;
}

export class PresenceManager {
  private client: Client | null = null;
  private appId = "";
  private connected = false;
  private stopped = false;
  private connecting = false;
  private state: RpcState = {
    connected: false,
    error: null,
    lastUpdateAt: null,
  };

  private reconnectTimer: NodeJS.Timeout | null = null;
  private retryDelay = 5_000;
  private idleTimer: NodeJS.Timeout | null = null;
  private clearTimer: NodeJS.Timeout | null = null;
  private updateTimer: NodeJS.Timeout | null = null;

  private lastPayload: ActivityPayload | null = null;
  private lastActivityAt = 0;
  private sessionStartedAt: number | null = null;
  private sessionProject = "";
  private idleOverride = false;
  private lastSignature = "";
  private lastUpdateAt = 0;

  constructor(private readonly opts: PresenceOptions) {
    this.appId = opts.getAppId();
  }

  getState(): RpcState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (!this.appId) {
      this.setError("Discord Application ID missing");
      return;
    }
    await this.ensureConnection();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    await this.disconnect();
    this.lastPayload = null;
  }

  async setAppId(appId: string): Promise<void> {
    if (appId === this.appId) return;
    this.appId = appId;
    await this.disconnect();
    if (appId) {
      await this.ensureConnection();
    } else {
      this.setError("Discord Application ID missing");
    }
    this.opts.onChange();
  }

  async applySettings(): Promise<void> {
    const settings = this.opts.getSettings();
    if (!settings.rpcEnabled) {
      await this.disconnect();
      this.setError(null);
      return;
    }
    this.lastSignature = "";
    if (!this.client) {
      await this.ensureConnection();
    } else {
      this.queuePush(true);
    }
  }

  handleActivity(payload: ActivityPayload): void {
    const now = Date.now();
    const project = displayProjectName(payload.project);
    const gap = this.lastActivityAt ? now - this.lastActivityAt : Infinity;

    if (gap > 120_000 || this.sessionProject !== project) {
      this.sessionStartedAt = now;
      this.sessionProject = project;
    }

    this.lastActivityAt = now;
    this.lastPayload = payload;
    this.idleOverride = false;

    this.scheduleIdleTimers();
    this.queuePush();
  }

  private scheduleIdleTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.clearTimer) clearTimeout(this.clearTimer);

    this.idleTimer = setTimeout(() => {
      if (!this.lastPayload) return;
      this.idleOverride = true;
      this.queuePush(true);
    }, 120_000);

    this.clearTimer = setTimeout(() => {
      void this.clearPresence();
    }, 10 * 60_000);
  }

  private async clearPresence(): Promise<void> {
    if (this.client?.user) {
      try {
        await this.client.user.clearActivity();
      } catch {
        // Ignore: Discord may have closed.
      }
    }
    this.lastPayload = null;
    this.idleOverride = false;
    this.lastSignature = "";
    this.lastUpdateAt = Date.now();
    this.state.lastUpdateAt = this.lastUpdateAt;
    this.opts.onChange();
  }

  private buildActivity(payload: ActivityPayload): SetActivity {
    const settings = this.opts.getSettings();
    const privateMode = settings.privateMode || payload.privacy === "private";
    const idle = payload.idle || this.idleOverride;
    const project = displayProjectName(payload.project);
    const playLabel = PLAY_LABELS[payload.play.state] ?? "Editing";

    let details = project;
    let state = playLabel;

    if (privateMode) {
      details = "Private mode";
      state = "Roblox Studio";
    } else if (idle) {
      details = "Idle";
      state = project;
    } else if (payload.script) {
      state = `${payload.script.name || "Script"}:${payload.script.line}`;
      if (payload.play.state !== "edit") {
        state += ` · ${playLabel}`;
      }
    }

    const activity: SetActivity = {
      details: clampText(details),
      state: clampText(state),
      instance: false,
    };

    if (!privateMode && !idle && this.sessionStartedAt) {
      activity.startTimestamp = this.sessionStartedAt;
    }

    if (settings.largeImageKey) {
      activity.largeImageKey = settings.largeImageKey;
      activity.largeImageText = "Roblox Studio";
    }

    return activity;
  }

  private queuePush(force = false): void {
    if (force) this.lastSignature = "";
    if (this.updateTimer) return;

    const wait = Math.max(0, 4_000 - (Date.now() - this.lastUpdateAt));
    if (wait === 0) {
      void this.push();
      return;
    }

    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      void this.push();
    }, wait);
  }

  private async push(): Promise<void> {
    if (!this.client || !this.connected || !this.client.user) return;
    const payload = this.lastPayload;
    if (!payload) return;

    const activity = this.buildActivity(payload);
    const signature = JSON.stringify(activity);
    if (signature === this.lastSignature) return;

    try {
      await this.client.user.setActivity(activity);
      this.lastSignature = signature;
      this.lastUpdateAt = Date.now();
      this.state.lastUpdateAt = this.lastUpdateAt;
      this.setError(null);
    } catch (error) {
      this.setError(friendlyError(error));
      this.scheduleReconnect();
    }
  }

  private async ensureConnection(): Promise<void> {
    if (this.stopped || this.connecting) return;
    const settings = this.opts.getSettings();
    if (!this.appId) {
      this.setError("Discord Application ID missing");
      return;
    }
    if (!settings.rpcEnabled) return;

    this.connecting = true;
    const client = new Client({ clientId: this.appId });
    this.client = client;

    client.on("ready", () => {
      this.connected = true;
      this.retryDelay = 5_000;
      this.clearReconnect();
      this.setError(null);
      this.lastSignature = "";
      this.queuePush(true);
    });

    client.on("disconnected", () => {
      this.connected = false;
      this.client = null;
      if (!this.stopped) {
        this.setError("Discord is not running");
        this.scheduleReconnect();
      }
    });

    try {
      await client.login();
      if (client.isConnected) {
        this.connected = true;
        this.retryDelay = 5_000;
        this.clearReconnect();
        this.setError(null);
        this.lastSignature = "";
        this.queuePush(true);
      }
    } catch (error) {
      this.connected = false;
      this.client = null;
      this.setError(friendlyError(error));
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
      this.opts.onChange();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    if (!this.opts.getSettings().rpcEnabled || !this.appId) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnection();
    }, delay);
  }

  private clearReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async disconnect(): Promise<void> {
    this.clearReconnect();
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    const client = this.client;
    this.client = null;
    this.connected = false;
    this.lastSignature = "";
    if (client) {
      try {
        await client.user?.clearActivity();
      } catch {
        // Ignore.
      }
      try {
        await client.destroy();
      } catch {
        // Ignore.
      }
    }
    this.opts.onChange();
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.idleTimer = null;
    this.clearTimer = null;
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
    this.clearReconnect();
  }

  private setError(error: string | null): void {
    const connected = this.connected;
    if (
      this.state.error === error &&
      this.state.connected === connected
    ) {
      return;
    }
    this.state = {
      connected,
      error,
      lastUpdateAt: this.state.lastUpdateAt,
    };
    this.opts.onChange();
  }
}
