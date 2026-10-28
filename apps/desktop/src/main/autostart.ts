import { app } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AutoStartResult {
  ok: boolean;
  error?: string;
}

function linuxAutostartFile(): string {
  const configHome =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "autostart", "studio-beacon.desktop");
}

function escapeExec(value: string): string {
  return value.replace(/(["\\$`])/g, "\\$1");
}

export function applyAutoStart(enabled: boolean): AutoStartResult {
  // Registering the Electron binary in development would be confusing.
  if (!app.isPackaged) {
    return { ok: true };
  }

  try {
    if (process.platform === "linux") {
      const file = linuxAutostartFile();
      if (!enabled) {
        if (existsSync(file)) rmSync(file);
        return { ok: true };
      }
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        [
          "[Desktop Entry]",
          "Type=Application",
          "Name=Studio Beacon",
          "Comment=Show Roblox Studio activity on Discord",
          `Exec="${escapeExec(process.execPath)}" --hidden`,
          "Terminal=false",
          "X-GNOME-Autostart-enabled=true",
          "Categories=Development;",
          "",
        ].join("\n"),
      );
      return { ok: true };
    }

    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ["--hidden"],
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not update login items",
    };
  }
}
