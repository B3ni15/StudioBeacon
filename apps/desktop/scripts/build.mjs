import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateIcons } from "./make-icons.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(root, "dist");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

if (!existsSync(path.join(root, "build", "icon.png"))) {
  await generateIcons();
}

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["electron"],
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
};

await build({
  ...common,
  entryPoints: [path.join(root, "src/main/index.ts")],
  outfile: path.join(out, "main/index.cjs"),
});

await build({
  ...common,
  entryPoints: [path.join(root, "src/preload/index.ts")],
  outfile: path.join(out, "preload/index.cjs"),
});

await cp(path.join(root, "src/renderer"), path.join(out, "renderer"), {
  recursive: true,
});

console.log("desktop build complete");
