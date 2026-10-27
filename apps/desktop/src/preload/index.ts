import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  AppStatus,
  PluginInstallResult,
} from "@beacon/shared";

export interface StudioBeaconApi {
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

const api: StudioBeaconApi = {
  getStatus: () => ipcRenderer.invoke("beacon:getStatus"),
  onStatus: (listener) => {
    const handler = (_event: unknown, status: AppStatus) => listener(status);
    ipcRenderer.on("beacon:status", handler);
    return () => ipcRenderer.off("beacon:status", handler);
  },
  updateSettings: (patch) => ipcRenderer.invoke("beacon:updateSettings", patch),
  setDiscordAppId: (value) => ipcRenderer.invoke("beacon:setDiscordAppId", value),
  regenerateToken: () => ipcRenderer.invoke("beacon:regenerateToken"),
  copy: (text) => ipcRenderer.invoke("beacon:copy", text),
  installPlugin: () => ipcRenderer.invoke("beacon:installPlugin"),
  savePluginFile: () => ipcRenderer.invoke("beacon:savePluginFile"),
  openPluginsFolder: () => ipcRenderer.invoke("beacon:openPluginsFolder"),
  openExternal: (url) => ipcRenderer.invoke("beacon:openExternal", url),
  openDevPortal: () => ipcRenderer.invoke("beacon:openDevPortal"),
  show: () => ipcRenderer.invoke("beacon:show"),
  quit: () => ipcRenderer.invoke("beacon:quit"),
};

contextBridge.exposeInMainWorld("studioPresence", api);
