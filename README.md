# Studio Beacon

Show what you are building in **Roblox Studio** as **Discord Rich Presence**.

No account. No backend. No public profile. A small tray app talks to Discord on
your machine, and a Roblox Studio plugin tells it what you are working on.

```
Roblox Studio ──(plugin, localhost HTTP)──▶ Studio Beacon ──(Discord IPC)──▶ Discord
```

| Discord | In Studio |
| --- | --- |
| **Studio Beacon**<br>My Obby · line 42<br>Editing script: ServerScriptService.Game | Nothing extra to do — the plugin runs in the background. |

## Features

- Project name, active script and line number in your Discord status.
- **Team Create collaborators**: who you are working with, straight from Studio.
- Playtest / server / client states, idle detection, and a session timer.
- **Private mode** hides the place and script behind “Private mode”.
- Runs in the tray, starts at login, one click to quit.
- **Local only**: the plugin posts to `127.0.0.1`, the token never leaves your machine.
- Auto-updates from GitHub Releases.
- macOS (Intel + Apple Silicon), Windows (x64 + arm64), Linux (AppImage / deb).

## Install

1. Download the latest build from [Releases](https://github.com/B3ni15/StudioBeacon/releases).
2. Start **Studio Beacon** and keep it running (it lives in the tray).
3. Click **Install plugin** in the app. It writes `StudioBeacon.rbxmx` into your
   Roblox Plugins folder with the local token already baked in.
4. Restart Roblox Studio. The plugin appears in the **Plugins** tab.

That is it — the app ships with the **Studio Beacon** Discord application ID, so
there is nothing to register before your status shows up.

### Optional: use your own Discord application

If you would rather have your own app name and icons:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Name it whatever you want to see in Discord, e.g. `Studio Beacon`.
3. Copy the **Application ID** and paste it into the app → **Save**.
4. Upload your own art in **Rich Presence → Art Assets** and put its key in
   **Large image asset key**.

Discord must be the **desktop app** and it must be running — Rich Presence does
not work through the browser version.

### Optional: the big image

Discord shows the application icon by default. To use custom art, upload an
image under **Rich Presence → Art Assets** in your own application and put its
key in **Large image asset key**.

Ready-made 1024×1024 art lives in `apps/desktop/assets/discord`
(PNG, 1024×1024 — Discord recommends 1024, minimum 512):

| File | Suggested asset key |
| --- | --- |
| `roblox-studio-1024.png` | `robloxstudio` |
| `studio-beacon-1024.png` | `studio` |

```bash
pnpm discord-assets   # regenerate both PNGs
```

## Privacy

- The HTTP server binds to `127.0.0.1` only and requires a bearer token.
- The token is generated locally and stored with the OS keychain via Electron
  `safeStorage` where available.
- Only the project name, script name/line, play state, selection name and the
  display names of your Team Create collaborators are sent — to your own
  machine. Nothing is uploaded anywhere.
- **Private mode** replaces all of that with a static string.

## Build from source

Requirements: Node.js 22+, pnpm 10+.

```bash
pnpm install
pnpm build          # plugin + desktop bundles
pnpm dev            # run the desktop app from source
pnpm dist           # package for the current OS into apps/desktop/release
```

Other scripts:

```bash
pnpm typecheck      # tsc for every workspace package
pnpm build:plugin   # only apps/plugin/dist/StudioBeacon.rbxmx
pnpm icons          # regenerate the app / tray icons
```

### Using the plugin without the desktop app's installer

`pnpm build:plugin` produces `apps/plugin/dist/StudioBeacon.rbxmx` with
placeholders instead of a token. Either install it through the app, or paste
your local server URL and token into the plugin's **Settings** widget in Studio.

For Rojo users there is also `apps/plugin/default.project.json`.

## Releasing and auto-update

The app uses [`electron-updater`](https://www.electron.build/auto-update) with a
GitHub Releases feed (configured in `apps/desktop/electron-builder.yml`).

```bash
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml` then:

1. sets the desktop package version from the tag,
2. builds macOS, Windows and Linux packages,
3. publishes the installers plus `latest.yml` / `latest-mac.yml` to the release.

Installed apps check for updates on launch and every 6 hours, download in the
background, and show **Restart & update** when a new version is ready.

> **macOS note:** Squirrel.Mac only installs updates for signed apps. Add the
> `MAC_CERT_P12`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`
> and `APPLE_TEAM_ID` repository secrets to enable signing and notarization.
> Without them macOS builds still work, but updates must be downloaded manually.

`.github/workflows/ci.yml` runs the typecheck and a full build on Linux, Windows
and macOS for every push and pull request.

## Project layout

```
apps/desktop        Electron app (main, preload, renderer)
apps/plugin         Roblox Studio plugin (Luau → .rbxmx)
packages/shared     Zod payload schema + shared types
```

## Credits

- Inspired by [RobloxStudio-DiscordRPC](https://github.com/RobloxStudio-DiscordRPC)
  (MIT, © 2022 MatusGuy). See `THIRD_PARTY_NOTICES.md`.
- Roblox Studio and Discord are trademarks of their respective owners. This
  project is not affiliated with or endorsed by Roblox Corporation or Discord Inc.

## License

MIT — see [LICENSE](LICENSE).

---

## Magyar gyorsútmutató

1. Töltsd le a legújabb kiadást a **Releases** alól, és indítsd el az appot (tálcán fut tovább).
2. **Install plugin** → ez beírja a `StudioBeacon.rbxmx`-t a Roblox Plugins mappába,
   a helyi tokennel együtt.
3. Indítsd újra a Roblox Studio-t. Kész.

Az app alapból a **Studio Beacon** Discord Application ID-t használja, így nem
kell saját appot regisztrálnod. Ha mégis a saját nevedet és ikonjaidat akarod
látni: [Discord Developer Portal](https://discord.com/developers/applications)
→ **New Application** → az **Application ID**-t illeszd be az appba → **Save**.

Az app és a plugin is helyben fut: a plugin csak `127.0.0.1`-re küld, tokennel
védve. Nincs fiók, nincs szerver, nincs telemetria. Új verzió:
`git tag v0.2.0 && git push origin v0.2.0` → a GitHub Action kirakja a Release-t,
és a telepített app magától frissül.
