import { app, dialog } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginInstallResult } from "@beacon/shared";

const PLUGIN_FILE = "StudioBeacon.rbxmx";
const TOKEN_PLACEHOLDER = "__STUDIO_BEACON_TOKEN__";
const URL_PLACEHOLDER = "__STUDIO_BEACON_URL__";

const SAFE_TOKEN_RE = /^[A-Za-z0-9_-]{4,128}$/;
const SAFE_URL_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;

export function bundledPluginPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, PLUGIN_FILE);
  }
  return path.resolve(__dirname, "../../../plugin/dist", PLUGIN_FILE);
}

function linuxPluginsDir(): string | null {
  // Vinegar (Wine-based) keeps a normal Windows install inside a prefix.
  const vinegarUsers = path.join(
    os.homedir(),
    ".local",
    "share",
    "vinegar",
    "prefix",
    "drive_c",
    "users",
  );
  try {
    for (const user of readdirSync(vinegarUsers)) {
      const candidate = path.join(
        vinegarUsers,
        user,
        "AppData",
        "Local",
        "Roblox",
        "Plugins",
      );
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Not a Vinegar install.
  }
  return null;
}

export function getPluginsDir(): string | null {
  if (process.platform === "darwin") {
    return path.join(app.getPath("documents"), "Roblox", "Plugins");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? app.getPath("appData");
    return path.join(local, "Roblox", "Plugins");
  }
  return linuxPluginsDir();
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

/**
 * The shipped .rbxmx contains placeholders; the app writes the real token and
 * ingest URL into the copy that ends up in the Roblox Plugins folder.
 */
function renderPlugin(token: string, ingestUrl: string): string | null {
  const source = bundledPluginPath();
  if (!existsSync(source)) return null;

  const safeToken = SAFE_TOKEN_RE.test(token) ? token : "";
  const safeUrl = SAFE_URL_RE.test(ingestUrl) ? ingestUrl : "http://127.0.0.1:47831";

  return readFileSync(source, "utf8")
    .split(TOKEN_PLACEHOLDER)
    .join(safeToken)
    .split(URL_PLACEHOLDER)
    .join(safeUrl);
}

function missingPlugin(): PluginInstallResult {
  return {
    ok: false,
    error: "The bundled plugin file is missing. Run `pnpm build:plugin` first.",
  };
}

export function installPlugin(
  targetDir: string,
  token: string,
  ingestUrl: string,
): PluginInstallResult {
  const rendered = renderPlugin(token, ingestUrl);
  if (rendered === null) return missingPlugin();

  try {
    mkdirSync(targetDir, { recursive: true });
    const destination = path.join(targetDir, PLUGIN_FILE);
    writeFileSync(destination, rendered, "utf8");
    return { ok: true, path: destination };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not install the plugin",
    };
  }
}

export async function savePluginFile(
  token: string,
  ingestUrl: string,
): Promise<PluginInstallResult> {
  const rendered = renderPlugin(token, ingestUrl);
  if (rendered === null) return missingPlugin();

  const result = await dialog.showSaveDialog({
    title: "Save the Studio Beacon plugin",
    defaultPath: path.join(app.getPath("downloads"), PLUGIN_FILE),
    filters: [{ name: "Roblox plugin", extensions: ["rbxmx"] }],
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, error: "cancelled" };
  }

  try {
    writeFileSync(result.filePath, rendered, "utf8");
    return { ok: true, path: result.filePath };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the plugin",
    };
  }
}
