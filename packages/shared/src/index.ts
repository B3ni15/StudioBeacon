import { z } from "zod";

export const APP_NAME = "Studio Beacon";
export const PLUGIN_VERSION = "1.0.0";

export const playStateSchema = z.enum(["edit", "play", "run", "server", "client"]);
export type PlayState = z.infer<typeof playStateSchema>;

export const PLAY_LABELS: Record<PlayState, string> = {
  edit: "Editing",
  play: "Playtesting",
  run: "Running",
  server: "Server",
  client: "Client",
};

const shortText = (max: number) => z.string().trim().max(max);

/**
 * The payload the Roblox Studio plugin sends to the local app.
 * Everything is optional except the project, so old/new plugin versions
 * can talk to each other without breaking.
 */
export const activityPayloadSchema = z.object({
  pluginVersion: shortText(32).optional(),
  studioUserId: z.number().int().nonnegative().optional(),
  sentAt: z.number().int().nonnegative().optional(),
  project: z.object({
    name: shortText(120).default("Untitled place"),
    placeId: z.number().int().nonnegative().default(0),
    gameId: z.number().int().nonnegative().default(0),
    creatorId: z.number().int().nonnegative().default(0),
    creatorType: shortText(24).default("User"),
  }),
  script: z
    .object({
      path: shortText(300),
      name: shortText(120),
      line: z.number().int().min(0).max(1_000_000).default(0),
      column: z.number().int().min(0).max(1_000_000).default(0),
      lineCount: z.number().int().min(0).max(1_000_000).default(0),
      viewportStart: z.number().int().min(0).max(1_000_000).nullable().optional(),
      viewportEnd: z.number().int().min(0).max(1_000_000).nullable().optional(),
    })
    .nullable()
    .optional(),
  selection: z
    .object({
      name: shortText(120),
      className: shortText(80),
      path: shortText(300),
    })
    .nullable()
    .optional(),
  /** Other people in the Team Create session (local user excluded). */
  collaborators: z
    .array(
      z.object({
        name: shortText(64),
        username: shortText(64).optional(),
      }),
    )
    .max(16)
    .default([]),
  play: z
    .object({
      state: playStateSchema.default("edit"),
      isRunning: z.boolean().default(false),
    })
    .default({ state: "edit", isRunning: false }),
  idle: z.boolean().default(false),
  focused: z.boolean().default(true),
  privacy: z.enum(["public", "private"]).default("public"),
});

export type ActivityPayload = z.infer<typeof activityPayloadSchema>;

export interface AppSettings {
  autoStart: boolean;
  rpcEnabled: boolean;
  privateMode: boolean;
  /** Optional Discord Rich Presence asset key, e.g. "studio". */
  largeImageKey: string;
  /** After this many seconds without interaction the plugin reports idle. */
  idleSeconds: number;
}

export interface RpcState {
  connected: boolean;
  error: string | null;
  lastUpdateAt: number | null;
}

export type AppPhase = "setup" | "waiting" | "live" | "paused";

export type UpdateState =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

export interface UpdateStatus {
  state: UpdateState;
  /** Version of the update that is available / downloaded. */
  version: string | null;
  percent: number;
  error: string | null;
  checkedAt: number | null;
}

export interface AppStatus {
  phase: AppPhase;
  version: string;
  ingestUrl: string;
  pluginToken: string;
  discordAppId: string;
  defaultDiscordAppId: string;
  activity: ActivityPayload | null;
  lastActivityAt: number | null;
  sessionStartedAt: number | null;
  pluginConnected: boolean;
  rpc: RpcState;
  settings: AppSettings;
  update: UpdateStatus;
  pluginInstalled: boolean;
  pluginPath: string | null;
  pluginsDir: string | null;
  platform: string;
  error: string | null;
}

export interface PluginInstallResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export const DISCORD_APP_ID_RE = /^\d{17,20}$/;

/**
 * Studio Beacon's own Discord application, built in so the app works out of
 * the box without asking every user to register an application. Users can
 * still paste their own Application ID in the settings.
 */
export const DEFAULT_DISCORD_APP_ID = "1564794087918403705";

export function displayProjectName(project: ActivityPayload["project"]): string {
  const name = project.name.trim();
  if (name && name.toLowerCase() !== "place1") return name;
  if (project.placeId > 0) return `Place ${project.placeId}`;
  return "Untitled place";
}

export function truncate(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
