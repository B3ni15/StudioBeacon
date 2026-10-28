import { PNG } from "pngjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Builds the 1024x1024 art assets for the Discord Developer Portal
 * (Rich Presence -> Art Assets).
 *
 * Discord accepts PNG/JPG/JPEG, recommends 1024x1024 and requires at least
 * 512x512. Upload the files from assets/discord and use the suggested keys.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(here, "..", "assets");
const outDir = path.resolve(assetsDir, "discord");
const sourceFile = path.resolve(assetsDir, "roblox-studio.png");

const SIZE = 1024;
const LIME = [182, 255, 60];
const DARK = [11, 13, 18];

function cubic(p0, p1, p2, p3, t) {
  const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const c = -0.5 * p0 + 0.5 * p2;
  return a * t * t * t + b * t * t + c * t + p1;
}

function sample(source, x, y, channel) {
  const px = Math.min(source.width - 1, Math.max(0, x));
  const py = Math.min(source.height - 1, Math.max(0, y));
  return source.data[(source.width * py + px) * 4 + channel];
}

/** Catmull-Rom upscale: keeps the mark edges crisp when going 256 -> 1024. */
function upscale(source, size) {
  const out = new PNG({ width: size, height: size });
  const scale = source.width / size;

  for (let y = 0; y < size; y++) {
    const fy = (y + 0.5) * scale - 0.5;
    const y1 = Math.floor(fy);
    const wy = fy - y1;

    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) * scale - 0.5;
      const x1 = Math.floor(fx);
      const wx = fx - x1;
      const o = (size * y + x) << 2;

      for (let c = 0; c < 4; c++) {
        const rows = [];
        for (let dy = -1; dy <= 2; dy++) {
          const v0 = sample(source, x1 - 1, y1 + dy, c);
          const v1 = sample(source, x1, y1 + dy, c);
          const v2 = sample(source, x1 + 1, y1 + dy, c);
          const v3 = sample(source, x1 + 2, y1 + dy, c);
          rows.push(cubic(v0, v1, v2, v3, wx));
        }
        out.data[o + c] = Math.round(
          Math.min(255, Math.max(0, cubic(rows[0], rows[1], rows[2], rows[3], wy))),
        );
      }
    }
  }

  return out;
}

function blend(png, x, y, color, coverage = 1) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height || coverage <= 0) return;
  const i = (png.width * y + x) << 2;
  const srcA = Math.min(1, coverage);
  const dstA = png.data[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    png.data[i + c] = Math.round(
      (color[c] * srcA + png.data[i + c] * dstA * (1 - srcA)) / outA,
    );
  }
  png.data[i + 3] = Math.round(outA * 255);
}

function circle(png, cx, cy, radius, color) {
  const x0 = Math.floor(cx - radius - 1);
  const y0 = Math.floor(cy - radius - 1);
  const x1 = Math.ceil(cx + radius + 1);
  const y1 = Math.ceil(cy + radius + 1);
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const dist = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
      blend(png, px, py, color, Math.min(1, Math.max(0, radius - dist + 0.5)));
    }
  }
}

function writePng(png, file) {
  return writeFile(file, PNG.sync.write(png));
}

export async function generateDiscordAssets() {
  await mkdir(outDir, { recursive: true });

  const source = PNG.sync.read(await readFile(sourceFile));

  // Large image: the plain Roblox Studio mark.
  const plain = upscale(source, SIZE);
  await writePng(plain, path.join(outDir, "roblox-studio-1024.png"));

  // Large image: the Studio Beacon version with the lime presence badge.
  const branded = upscale(source, SIZE);
  circle(branded, 852, 852, 118, DARK);
  circle(branded, 852, 852, 92, LIME);
  await writePng(branded, path.join(outDir, "studio-beacon-1024.png"));

  console.log("discord assets written to", outDir);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await generateDiscordAssets();
}
