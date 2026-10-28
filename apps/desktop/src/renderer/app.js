const api = window.studioPresence;

const $ = (id) => document.getElementById(id);

const PLAY_LABELS = {
  edit: "Editing",
  play: "Playtesting",
  run: "Running",
  server: "Server",
  client: "Client",
};

const PHASES = {
  live: { label: "Live on Discord", className: "pill pill--live" },
  waiting: { label: "Waiting for Studio", className: "pill pill--waiting" },
  setup: { label: "Setup needed", className: "pill pill--setup" },
  paused: { label: "Paused", className: "pill pill--paused" },
};

const RELEASES_URL = "https://github.com/B3ni15/StudioBeacon/releases";
const PORTAL_URL = "https://discord.com/developers/applications";

let status = null;
let tokenVisible = false;
let toastTimer = null;

/* ---------------- helpers ---------------- */

function setText(id, value) {
  const el = $(id);
  if (el && el.textContent !== value) el.textContent = value;
}

function setChip(id, textId, text, modifier) {
  const chip = $(id);
  const label = $(textId);
  if (label) label.textContent = text;
  if (!chip) return;
  const base = chip.classList.contains("chip--sm") ? "chip chip--sm" : "chip";
  chip.className = modifier ? `${base} ${modifier}` : base;
}

function projectName(project) {
  const name = (project?.name ?? "").trim();
  if (name && name.toLowerCase() !== "place1") return name;
  if ((project?.placeId ?? 0) > 0) return `Place ${project.placeId}`;
  return "Untitled place";
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function maskToken(token) {
  if (!token) return "";
  const head = token.slice(0, 3);
  const tail = token.slice(-4);
  return `${head}${"•".repeat(20)}${tail}`;
}

function setDetail(parts) {
  const el = $("now-detail");
  if (!el) return;
  el.textContent = "";
  for (const part of parts) {
    if (typeof part === "string") {
      el.append(document.createTextNode(part));
    } else {
      const span = document.createElement("span");
      span.className = "mono";
      span.textContent = part.mono;
      el.append(span);
    }
  }
}

function toast(message, isError = false) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast toast--show${isError ? " toast--error" : ""}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "toast";
  }, 2800);
}

function cleanError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "");
}

/* ---------------- render ---------------- */

function render() {
  if (!status) return;
  renderPhase();
  renderNow();
  renderDiscord();
  renderPlugin();
  renderPreferences();
  renderUpdate();
  renderMeta();
  renderTimer();
}

function renderPhase() {
  const phase = PHASES[status.phase] ?? PHASES.waiting;
  const pill = $("status-pill");
  if (pill) pill.className = phase.className;
  setText("status-pill-text", phase.label);
}

function renderNow() {
  const activity = status.activity;
  const live = status.pluginConnected && activity;

  if (!live) {
    setText(
      "now-project",
      status.phase === "setup" ? "Almost there" : "Waiting for Roblox Studio",
    );
    setDetail([
      status.phase === "setup"
        ? "Install the Studio plugin, then open Studio — your session shows up here."
        : "Install the plugin below, then open Studio — your session shows up here.",
    ]);
    setChip("chip-play", "chip-play-text", "Idle", null);
  } else {
    setText("now-project", projectName(activity.project));

    const playLabel = PLAY_LABELS[activity.play?.state] ?? "Editing";
    const collaborators = (activity.collaborators ?? [])
      .map((person) => (person.name ?? "").trim())
      .filter(Boolean);
    const withText =
      collaborators.length > 0
        ? [
            " · with ",
            collaborators.slice(0, 3).join(", "),
            collaborators.length > 3 ? ` +${collaborators.length - 3}` : "",
          ]
        : [];

    if (activity.idle) {
      setDetail(["Idle · ", { mono: projectName(activity.project) }, ...withText]);
    } else if (activity.script) {
      const line = activity.script.line ?? 0;
      setDetail([{ mono: activity.script.path }, ` · line ${line}`, ...withText]);
    } else if (activity.play?.state !== "edit") {
      setDetail([playLabel, ...withText]);
    } else if (activity.selection) {
      setDetail(["Selected ", { mono: activity.selection.path }, ...withText]);
    } else {
      setDetail(["Browsing in Studio", ...withText]);
    }

    setChip(
      "chip-play",
      "chip-play-text",
      activity.idle ? "Idle" : playLabel,
      activity.idle ? null : "chip--on",
    );
  }

  const rpc = status.rpc;
  if (rpc.connected) {
    setChip("chip-rpc", "chip-rpc-text", "Discord connected", "chip--on");
  } else if (rpc.error) {
    setChip("chip-rpc", "chip-rpc-text", "Discord offline", "chip--off");
  } else {
    setChip("chip-rpc", "chip-rpc-text", "Discord offline", null);
  }

  if (status.pluginConnected) {
    setChip("chip-plugin", "chip-plugin-text", "Plugin connected", "chip--on");
  } else {
    setChip("chip-plugin", "chip-plugin-text", "No plugin signal", "chip--warn");
  }
}

function renderDiscord() {
  const input = $("discord-id");
  if (input && document.activeElement !== input) {
    input.value = status.discordAppId ?? "";
  }

  const large = $("large-image");
  if (large && document.activeElement !== large) {
    large.value = status.settings.largeImageKey ?? "";
  }

  const dot = $("rpc-dot");
  const rpc = status.rpc;
  if (dot) {
    dot.className = rpc.connected ? "dot dot--on" : rpc.error ? "dot dot--off" : "dot";
  }

  let text = "Discord is not connected";
  if (rpc.connected) {
    text = "Connected — presence is updating";
  } else if (rpc.error) {
    text = rpc.error;
  } else if (!status.settings.rpcEnabled) {
    text = "Rich Presence is turned off";
  }
  setText("rpc-text", text);

  const privateToggle = $("toggle-private");
  if (privateToggle) privateToggle.checked = status.settings.privateMode;
}

function renderPlugin() {
  const installed = status.pluginInstalled;

  setText("plugin-state-text", installed ? "Installed" : "Not installed");
  const chip = $("plugin-state");
  if (chip) chip.className = installed ? "chip chip--sm chip--on" : "chip chip--sm chip--warn";

  setText("install-plugin-text", installed ? "Reinstall plugin" : "Install plugin");

  const path = $("plugin-path");
  if (path) {
    path.textContent = installed && status.pluginPath
      ? `Installed at ${status.pluginPath}`
      : status.pluginsDir
        ? `Target folder: ${status.pluginsDir}`
        : "The plugin is installed into your local Roblox Plugins folder.";
  }

  const url = $("ingest-url");
  if (url) url.value = status.ingestUrl || "starting…";

  const token = $("token-value");
  if (token) {
    token.value = tokenVisible
      ? status.pluginToken
      : maskToken(status.pluginToken);
  }

  const eye = $("toggle-token");
  if (eye) {
    eye.querySelector("use")?.setAttribute("href", tokenVisible ? "#i-eye-off" : "#i-eye");
  }
}

function renderPreferences() {
  const autoStart = $("toggle-autostart");
  if (autoStart) autoStart.checked = status.settings.autoStart;

  const rpc = $("toggle-rpc");
  if (rpc) rpc.checked = status.settings.rpcEnabled;

  const idle = $("idle-select");
  if (idle && document.activeElement !== idle) {
    idle.value = String(status.settings.idleSeconds);
  }
}

function renderUpdate() {
  const update = status.update;
  const progress = $("update-progress");
  const fill = $("update-fill");
  const action = $("update-action");
  const actionText = $("update-action-text");

  let text = "Not checked yet.";
  let actionLabel = "Check for updates";
  let actionDisabled = false;
  let showProgress = false;

  switch (update.state) {
    case "disabled":
      text = "Updates are available in the installed build.";
      actionDisabled = true;
      break;
    case "checking":
      text = "Checking GitHub for a newer version…";
      actionDisabled = true;
      actionLabel = "Checking…";
      break;
    case "available":
      text = `Version ${update.version} found — downloading…`;
      actionDisabled = true;
      actionLabel = "Downloading…";
      break;
    case "downloading":
      text = `Downloading version ${update.version ?? ""} — ${update.percent}%`;
      actionDisabled = true;
      actionLabel = "Downloading…";
      showProgress = true;
      break;
    case "downloaded":
      text = `Version ${update.version} is ready. Restart to install it.`;
      actionLabel = "Restart & update";
      break;
    case "up-to-date":
      text = "You are on the latest version.";
      break;
    case "error":
      text = update.error ?? "Could not check for updates.";
      break;
    default:
      text = "Not checked yet.";
  }

  setText("update-text", text);
  if (actionText) actionText.textContent = actionLabel;
  if (action) action.disabled = actionDisabled;

  if (progress && fill) {
    progress.hidden = !showProgress;
    fill.style.width = `${Math.max(0, Math.min(100, update.percent))}%`;
  }
}

function renderMeta() {
  setText("app-version", `v${status.version}`);
  const platformNames = { darwin: "macOS", win32: "Windows", linux: "Linux" };
  setText("footer-platform", platformNames[status.platform] ?? status.platform);
}

function renderTimer() {
  const el = $("session-timer");
  if (!el) return;
  const started = status?.sessionStartedAt;
  const live = status?.pluginConnected && status?.activity;
  if (!started || !live) {
    el.textContent = "—";
    return;
  }
  el.textContent = formatDuration(Date.now() - started);
}

/* ---------------- actions ---------------- */

async function saveDiscordId() {
  const input = $("discord-id");
  if (!input) return;
  const value = input.value.trim();
  try {
    apply(await api.setDiscordAppId(value));
    toast(value ? "Discord Application ID saved" : "Discord Application ID cleared");
  } catch (error) {
    toast(cleanError(error), true);
  }
}

async function installPlugin() {
  try {
    const result = await api.installPlugin();
    if (result.ok) {
      toast("Plugin installed — restart Studio to load it");
    } else if (result.error && result.error !== "cancelled") {
      toast(result.error, true);
    }
  } catch (error) {
    toast(cleanError(error), true);
  }
}

async function savePluginFile() {
  try {
    const result = await api.savePluginFile();
    if (result.ok) {
      toast("Plugin file saved");
    } else if (result.error && result.error !== "cancelled") {
      toast(result.error, true);
    }
  } catch (error) {
    toast(cleanError(error), true);
  }
}

async function regenerateToken() {
  const ok = window.confirm(
    "Regenerate the plugin token?\n\nThe installed plugin keeps working only if it is reinstalled.",
  );
  if (!ok) return;

  try {
    const next = await api.regenerateToken();
    apply(next);
    if (next.pluginInstalled) {
      const result = await api.installPlugin();
      if (result.ok) {
        toast("Token regenerated — plugin updated");
        return;
      }
    }
    toast("Token regenerated — reinstall the plugin");
  } catch (error) {
    toast(cleanError(error), true);
  }
}

async function copyText(value, message) {
  if (!value) {
    toast("Nothing to copy yet", true);
    return;
  }
  const ok = await api.copy(value);
  toast(ok ? message : "Could not copy", !ok);
}

/* ---------------- wiring ---------------- */

$("save-discord")?.addEventListener("click", () => void saveDiscordId());
$("use-default-discord")?.addEventListener("click", () => {
  const input = $("discord-id");
  if (!input) return;
  input.value = status.defaultDiscordAppId ?? "";
  void saveDiscordId();
});
$("discord-id")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void saveDiscordId();
});

$("open-portal")?.addEventListener("click", () => void api.openExternal(PORTAL_URL));
$("open-releases")?.addEventListener("click", () => void api.openExternal(RELEASES_URL));

$("toggle-private")?.addEventListener("change", (event) => {
  void api.updateSettings({ privateMode: event.target.checked });
});

$("toggle-autostart")?.addEventListener("change", (event) => {
  void api.updateSettings({ autoStart: event.target.checked });
});

$("toggle-rpc")?.addEventListener("change", (event) => {
  void api.updateSettings({ rpcEnabled: event.target.checked });
});

$("idle-select")?.addEventListener("change", (event) => {
  void api.updateSettings({ idleSeconds: Number(event.target.value) });
});

$("large-image")?.addEventListener("change", (event) => {
  void api.updateSettings({ largeImageKey: event.target.value.trim() });
});

$("install-plugin")?.addEventListener("click", () => void installPlugin());
$("save-plugin")?.addEventListener("click", () => void savePluginFile());
$("open-plugins")?.addEventListener("click", async () => {
  const result = await api.openPluginsFolder();
  if (!result.ok && result.error) toast(result.error, true);
});

$("copy-url")?.addEventListener("click", () => void copyText(status?.ingestUrl, "Server URL copied"));
$("copy-token")?.addEventListener("click", () => void copyText(status?.pluginToken, "Token copied"));

$("toggle-token")?.addEventListener("click", () => {
  tokenVisible = !tokenVisible;
  renderPlugin();
});

$("regen-token")?.addEventListener("click", () => void regenerateToken());

$("update-action")?.addEventListener("click", async () => {
  if (status?.update.state === "downloaded") {
    await api.installUpdate();
    return;
  }
  apply(await api.checkForUpdates());
});

$("quit-app")?.addEventListener("click", () => void api.quit());

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "q") {
    event.preventDefault();
    void api.quit();
  }
});

/* ---------------- boot ---------------- */

function apply(next) {
  if (!next) return;
  status = next;
  render();
}

api.onStatus(apply);
api.getStatus().then(apply).catch((error) => toast(cleanError(error), true));

setInterval(renderTimer, 1000);
