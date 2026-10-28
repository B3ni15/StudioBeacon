import { app } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { UpdateStatus } from "@beacon/shared";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 12_000;

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/net::|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
    return "Could not reach GitHub. Check your connection.";
  }
  if (/404|Cannot find channel|latest\.yml/i.test(message)) {
    return "No published release found yet.";
  }
  return message.length > 200 ? `${message.slice(0, 199)}…` : message;
}

export class UpdateManager {
  private state: UpdateStatus = {
    state: "idle",
    version: null,
    percent: 0,
    error: null,
    checkedAt: null,
  };

  private started = false;
  private firstCheck: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly onChange: () => void) {}

  getState(): UpdateStatus {
    return { ...this.state };
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // Auto-update only works from a packaged build with an app-update.yml.
    if (!app.isPackaged) {
      this.set({ state: "disabled", error: null });
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on("checking-for-update", () => {
      this.set({ state: "checking", error: null });
    });

    autoUpdater.on("update-available", (info: UpdateInfo) => {
      this.set({ state: "available", version: info.version, percent: 0 });
    });

    autoUpdater.on("update-not-available", () => {
      this.set({
        state: "up-to-date",
        version: null,
        percent: 0,
        checkedAt: Date.now(),
      });
    });

    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      this.set({
        state: "downloading",
        percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      });
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      this.set({
        state: "downloaded",
        version: info.version,
        percent: 100,
        checkedAt: Date.now(),
      });
    });

    autoUpdater.on("error", (error: Error) => {
      this.set({ state: "error", error: friendlyError(error) });
    });

    this.firstCheck = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS);
    this.interval = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.set({
        state: "disabled",
        error: "Updates are only available in the installed app.",
      });
      return this.getState();
    }

    if (this.state.state === "checking" || this.state.state === "downloading") {
      return this.getState();
    }

    this.set({ state: "checking", error: null, checkedAt: Date.now() });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.set({ state: "error", error: friendlyError(error) });
    }
    return this.getState();
  }

  install(): boolean {
    if (this.state.state !== "downloaded") return false;
    // Give Electron a moment to flush the status update to the UI.
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch {
        // The user can still restart the app manually.
      }
    }, 150);
    return true;
  }

  stop(): void {
    if (this.firstCheck) clearTimeout(this.firstCheck);
    if (this.interval) clearInterval(this.interval);
    this.firstCheck = null;
    this.interval = null;
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.state = { ...this.state, ...patch };
    this.onChange();
  }
}
