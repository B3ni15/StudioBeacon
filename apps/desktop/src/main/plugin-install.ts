import { app, dialog } from "electron";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { PluginInstallResult } from "@studio/shared";

const PLUGIN_FILE = "StudioPresence.rbxmx";

export function bundledPluginPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, PLUGIN_FILE);
  }
  return path.resolve(__dirname, "../../../plugin/dist", PLUGIN_FILE);
}

export function getPluginsDir(): string | null {
  if (process.platform === "darwin") {
    return path.join(app.getPath("documents"), "Roblox", "Plugins");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? app.getPath("appData");
    return path.join(local, "Roblox", "Plugins");
  }
  return null;
}

export function installedPluginPath(): string | null {
  const dir = getPluginsDir();
  if (!dir) return null;
  const file = path.join(dir, PLUGIN_FILE);
  return existsSync(file) ? file : null;
}

export function pluginInstalled(): boolean {
  return installedPluginPath() !== null;
}

export function installPlugin(targetDir: string): PluginInstallResult {
  const source = bundledPluginPath();
  if (!existsSync(source)) {
    return {
      ok: false,
      error: "The bundled plugin file is missing. Run `pnpm build:plugin` first.",
    };
  }
  try {
    mkdirSync(targetDir, { recursive: true });
    const destination = path.join(targetDir, PLUGIN_FILE);
    copyFileSync(source, destination);
    return { ok: true, path: destination };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not install the plugin",
    };
  }
}

export async function savePluginFile(): Promise<PluginInstallResult> {
  const source = bundledPluginPath();
  if (!existsSync(source)) {
    return {
      ok: false,
      error: "The bundled plugin file is missing. Run `pnpm build:plugin` first.",
    };
  }
  const result = await dialog.showSaveDialog({
    title: "Save the Studio Presence plugin",
    defaultPath: path.join(app.getPath("downloads"), PLUGIN_FILE),
    filters: [{ name: "Roblox plugin", extensions: ["rbxmx"] }],
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, error: "cancelled" };
  }
  try {
    copyFileSync(source, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the plugin",
    };
  }
}
