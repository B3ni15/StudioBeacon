import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from "electron";
import path from "node:path";
import {
  DISCORD_APP_ID_RE,
  displayProjectName,
  type ActivityPayload,
  type AppSettings,
  type AppStatus,
  type PluginInstallResult,
} from "@studio/shared";
import { applyAutoStart } from "./autostart";
import { ConfigStore } from "./config";
import { IngestServer } from "./ingest";
import { installPlugin, installedPluginPath, getPluginsDir, savePluginFile } from "./plugin-install";
import { PresenceManager } from "./presence";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: ConfigStore;
let ingest: IngestServer;
let presence: PresenceManager;

let lastActivity: ActivityPayload | null = null;
let lastActivityAt: number | null = null;
let sessionStartedAt: number | null = null;
let startupError: string | null = null;
let quitting = false;
let lastStatusKey = "";
let lastTrayKey = "";
let startHidden = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function getStatus(): AppStatus {
  const settings = store.getSettings();
  const pluginConnected =
    lastActivityAt !== null && Date.now() - lastActivityAt < 15_000;
  const phase = startupError
    ? "paused"
    : !store.getDiscordAppId()
      ? "setup"
      : pluginConnected
        ? "live"
        : "waiting";
  const installed = installedPluginPath();

  return {
    phase,
    version: app.getVersion(),
    ingestUrl: ingest.getPort() > 0 ? ingest.getUrl() : "",
    pluginToken: store.getToken(),
    discordAppId: store.getDiscordAppId(),
    activity: lastActivity,
    lastActivityAt,
    sessionStartedAt,
    pluginConnected,
    rpc: presence.getState(),
    settings,
    pluginInstalled: installed !== null,
    pluginPath: installed,
    pluginsDir: getPluginsDir(),
    platform: process.platform,
    error: startupError,
  };
}

function pushStatus(force = false): void {
  if (!store || !ingest) return;
  const status = getStatus();
  const key = JSON.stringify(status);
  if (!force && key === lastStatusKey) return;
  lastStatusKey = key;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:status", status);
  }
  updateTray(status);
}

function traySummary(status: AppStatus): string {
  if (status.phase === "setup") return "Set your Discord Application ID";
  if (!status.pluginConnected || !status.activity) {
    return "Waiting for Roblox Studio";
  }
  const project = displayProjectName(status.activity.project);
  const script = status.activity.script
    ? `${status.activity.script.name}:${status.activity.script.line}`
    : status.activity.play.state === "edit"
      ? "Building"
      : "Playtesting";
  return `${project} · ${script}`;
}

function updateTray(status: AppStatus): void {
  if (!tray) return;
  const summary = traySummary(status);
  const key = [
    status.phase,
    status.rpc.connected,
    status.settings.autoStart,
    status.settings.rpcEnabled,
    status.pluginInstalled,
    summary,
  ].join("|");
  if (key === lastTrayKey) return;
  lastTrayKey = key;

  tray.setToolTip(`Studio Presence — ${summary}`);

  const template: MenuItemConstructorOptions[] = [
    {
      label: "Open Studio Presence",
      click: () => showWindow(),
    },
    {
      label: summary.length > 70 ? `${summary.slice(0, 69)}…` : summary,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Copy plugin token",
      click: () => clipboard.writeText(store.getToken()),
    },
    {
      label: status.pluginInstalled ? "Reinstall Studio plugin" : "Install Studio plugin",
      click: () => void installFromMenu(),
    },
    { type: "separator" },
    {
      label: "Start at login",
      type: "checkbox",
      checked: status.settings.autoStart,
      click: (item) => {
        const result = applyAutoStart(item.checked);
        store.updateSettings({ autoStart: item.checked });
        if (!result.ok) startupError = result.error ?? null;
        pushStatus(true);
      },
    },
    { type: "separator" },
    {
      label: "Quit Studio Presence",
      click: () => void quitApp(),
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

async function installFromMenu(): Promise<void> {
  let dir = getPluginsDir();
  if (!dir) {
    const result = await dialog.showOpenDialog({
      title: "Select your Roblox Plugins folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return;
    dir = result.filePaths[0];
  }
  const installed = installPlugin(dir);
  if (!installed.ok) {
    startupError = installed.error ?? "Could not install the plugin";
  }
  pushStatus(true);
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) return;

  mainWindow = new BrowserWindow({
    width: 1020,
    height: 780,
    minWidth: 760,
    minHeight: 600,
    show: false,
    backgroundColor: "#0b0d12",
    title: "Studio Presence",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    if (!startHidden) mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      if (url.startsWith("https://")) void shell.openExternal(url);
    }
  });
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  const iconName = process.platform === "darwin" ? "trayTemplate.png" : "tray.png";
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, iconName)
    : path.join(__dirname, "../../build", iconName);

  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(
      app.isPackaged
        ? path.join(process.resourcesPath, "tray.png")
        : path.join(__dirname, "../../build", "tray.png"),
    );
  }
  if (icon.isEmpty()) return;

  if (process.platform === "darwin") icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.on("click", () => showWindow());
  tray.on("double-click", () => showWindow());
  updateTray(getStatus());
}

async function quitApp(): Promise<void> {
  if (quitting) return;
  quitting = true;
  try {
    await presence.stop();
  } catch {
    // Best effort.
  }
  try {
    await ingest.stop();
  } catch {
    // Best effort.
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

function handleActivity(payload: ActivityPayload): void {
  const now = Date.now();
  const project = displayProjectName(payload.project);
  if (
    lastActivityAt === null ||
    !lastActivity ||
    now - lastActivityAt > 120_000 ||
    displayProjectName(lastActivity.project) !== project
  ) {
    sessionStartedAt = now;
  }

  lastActivity = payload;
  lastActivityAt = now;
  presence.handleActivity(payload);
  pushStatus();
}

function registerIpc(): void {
  ipcMain.handle("app:getStatus", () => getStatus());

  ipcMain.handle("app:updateSettings", (_event, patch: Partial<AppSettings>) => {
    if (!patch || typeof patch !== "object") return getStatus();
    const before = store.getSettings();
    const after = store.updateSettings(patch);
    if (before.autoStart !== after.autoStart) {
      const result = applyAutoStart(after.autoStart);
      if (!result.ok) startupError = result.error ?? null;
    }
    void presence.applySettings();
    pushStatus(true);
    return getStatus();
  });

  ipcMain.handle("app:setDiscordAppId", async (_event, value: unknown) => {
    const id = String(value ?? "").trim();
    if (id && !DISCORD_APP_ID_RE.test(id)) {
      throw new Error("A Discord Application ID must be 17–20 digits.");
    }
    store.setDiscordAppId(id);
    await presence.setAppId(id);
    pushStatus(true);
    return getStatus();
  });

  ipcMain.handle("app:regenerateToken", () => {
    store.regenerateToken();
    pushStatus(true);
    return getStatus();
  });

  ipcMain.handle("app:copy", (_event, text: unknown) => {
    clipboard.writeText(String(text ?? "").slice(0, 4096));
    return true;
  });

  ipcMain.handle("app:installPlugin", async (): Promise<PluginInstallResult> => {
    let dir = getPluginsDir();
    if (!dir) {
      const result = await dialog.showOpenDialog({
        title: "Select your Roblox Plugins folder",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, error: "cancelled" };
      }
      dir = result.filePaths[0];
    }
    const installed = installPlugin(dir);
    if (!installed.ok) startupError = installed.error ?? "Could not install the plugin";
    pushStatus(true);
    return installed;
  });

  ipcMain.handle("app:savePluginFile", () => savePluginFile());

  ipcMain.handle("app:openPluginsFolder", async () => {
    const dir = getPluginsDir();
    if (!dir) return { ok: false, error: "Choose a folder during plugin install." };
    const error = await shell.openPath(dir);
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.handle("app:openExternal", async (_event, url: unknown) => {
    const value = String(url ?? "");
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") return false;
      await shell.openExternal(parsed.toString());
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("app:openDevPortal", async () => {
    await shell.openExternal("https://discord.com/developers/applications");
    return true;
  });

  ipcMain.handle("app:show", () => {
    showWindow();
    return true;
  });

  ipcMain.handle("app:quit", async () => {
    await quitApp();
    return true;
  });
}

async function bootstrap(): Promise<void> {
  app.setName("Studio Presence");
  if (process.platform === "win32") {
    app.setAppUserModelId("com.studiopresence.app");
  }

  startHidden =
    process.argv.includes("--hidden") ||
    app.getLoginItemSettings().wasOpenedAtLogin;

  store = new ConfigStore();
  presence = new PresenceManager({
    getAppId: () => store.getDiscordAppId(),
    getSettings: () => store.getSettings(),
    onChange: () => pushStatus(),
  });

  ingest = new IngestServer({
    preferredPort: store.getIngestPort(),
    version: app.getVersion(),
    getToken: () => store.getToken(),
    onActivity: handleActivity,
    onPortChange: (port) => {
      if (port !== store.getIngestPort()) store.setIngestPort(port);
    },
    onError: (message) => {
      startupError = message;
      pushStatus(true);
    },
  });

  try {
    await ingest.start();
  } catch (error) {
    startupError =
      error instanceof Error
        ? error.message
        : "Could not start the local plugin server";
  }

  const autoStart = applyAutoStart(store.getSettings().autoStart);
  if (!autoStart.ok) startupError = autoStart.error ?? null;

  registerIpc();
  createWindow();
  createTray();
  await presence.start();
  pushStatus(true);

  setInterval(() => pushStatus(), 5_000);
}

if (gotLock) {
  app.on("second-instance", () => showWindow());

  app.on("window-all-closed", () => {
    // Keep running in the tray.
  });

  app.on("activate", () => showWindow());

  app.on("before-quit", (event) => {
    if (!quitting) {
      event.preventDefault();
      void quitApp();
    }
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      console.error("Studio Presence failed to start", error);
      startupError =
        error instanceof Error ? error.message : "Studio Presence failed to start";
    });
}
