import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  AppStatus,
  PluginInstallResult,
} from "@studio/shared";

export interface StudioPresenceApi {
  getStatus: () => Promise<AppStatus>;
  onStatus: (listener: (status: AppStatus) => void) => () => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppStatus>;
  setDiscordAppId: (value: string) => Promise<AppStatus>;
  regenerateToken: () => Promise<AppStatus>;
  copy: (text: string) => Promise<boolean>;
  installPlugin: () => Promise<PluginInstallResult>;
  savePluginFile: () => Promise<PluginInstallResult>;
  openPluginsFolder: () => Promise<{ ok: boolean; error?: string }>;
  openExternal: (url: string) => Promise<boolean>;
  openDevPortal: () => Promise<boolean>;
  show: () => Promise<boolean>;
  quit: () => Promise<boolean>;
}

const api: StudioPresenceApi = {
  getStatus: () => ipcRenderer.invoke("app:getStatus"),
  onStatus: (listener) => {
    const handler = (_event: unknown, status: AppStatus) => listener(status);
    ipcRenderer.on("app:status", handler);
    return () => ipcRenderer.off("app:status", handler);
  },
  updateSettings: (patch) => ipcRenderer.invoke("app:updateSettings", patch),
  setDiscordAppId: (value) => ipcRenderer.invoke("app:setDiscordAppId", value),
  regenerateToken: () => ipcRenderer.invoke("app:regenerateToken"),
  copy: (text) => ipcRenderer.invoke("app:copy", text),
  installPlugin: () => ipcRenderer.invoke("app:installPlugin"),
  savePluginFile: () => ipcRenderer.invoke("app:savePluginFile"),
  openPluginsFolder: () => ipcRenderer.invoke("app:openPluginsFolder"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  openDevPortal: () => ipcRenderer.invoke("app:openDevPortal"),
  show: () => ipcRenderer.invoke("app:show"),
  quit: () => ipcRenderer.invoke("app:quit"),
};

contextBridge.exposeInMainWorld("studioPresence", api);
