import { PNG } from "pngjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(here, "..", "build");
const sourceFile = path.resolve(here, "..", "assets", "roblox-studio.png");

const LIME = [182, 255, 60];
const DARK = [11, 13, 18];
const BLACK = [0, 0, 0];

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
      const coverage = Math.min(1, Math.max(0, radius - dist + 0.5));
      blend(png, px, py, color, coverage);
    }
  }
}

function resize(source, size) {
  const out = new PNG({ width: size, height: size });
  const sx = source.width / size;
  const sy = source.height / size;
  for (let y = 0; y < size; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const wy = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const wx = Math.max(0, Math.min(1, fx - x0));
      const o = (size * y + x) << 2;
      for (let c = 0; c < 4; c++) {
        const p00 = source.data[(source.width * y0 + x0) * 4 + c];
        const p10 = source.data[(source.width * y0 + x1) * 4 + c];
        const p01 = source.data[(source.width * y1 + x0) * 4 + c];
        const p11 = source.data[(source.width * y1 + x1) * 4 + c];
        const top = p00 + (p10 - p00) * wx;
        const bottom = p01 + (p11 - p01) * wx;
        out.data[o + c] = Math.round(top + (bottom - top) * wy);
      }
    }
  }
  return out;
}

/**
 * Builds a monochrome silhouette from the white Roblox Studio mark.
 * The white mark becomes opaque; the black rounded square becomes transparent.
 */
function silhouette(source) {
  const out = new PNG({ width: source.width, height: source.height });
  for (let i = 0; i < source.data.length; i += 4) {
    const r = source.data[i];
    const g = source.data[i + 1];
    const b = source.data[i + 2];
    const a = source.data[i + 3];
    const luminance = (r + g + b) / 3;
    out.data[i] = 255;
    out.data[i + 1] = 255;
    out.data[i + 2] = 255;
    out.data[i + 3] = Math.round((luminance / 255) * a);
  }
  return out;
}

function tint(source, color) {
  const out = new PNG({ width: source.width, height: source.height });
  for (let i = 0; i < source.data.length; i += 4) {
    out.data[i] = color[0];
    out.data[i + 1] = color[1];
    out.data[i + 2] = color[2];
    out.data[i + 3] = source.data[i + 3];
  }
  return out;
}

function writePng(png, file) {
  return writeFile(file, PNG.sync.write(png));
}

export async function generateIcons() {
  await mkdir(buildDir, { recursive: true });

  const source = PNG.sync.read(await readFile(sourceFile));

  // App icon: current Roblox Studio mark + a lime presence badge.
  const icon = resize(source, 1024);
  circle(icon, 806, 806, 126, DARK);
  circle(icon, 806, 806, 100, LIME);
  await writePng(icon, path.join(buildDir, "icon.png"));

  // Tray: the Studio "R" silhouette, readable at 16–32 px.
  const mark = silhouette(source);
  for (const [size, name] of [
    [32, "trayTemplate.png"],
    [64, "trayTemplate@2x.png"],
  ]) {
    await writePng(
      tint(resize(mark, size), BLACK),
      path.join(buildDir, name),
    );
  }
  for (const [size, name] of [
    [32, "tray.png"],
    [64, "tray@2x.png"],
  ]) {
    await writePng(tint(resize(mark, size), LIME), path.join(buildDir, name));
  }

  console.log("icons written to", buildDir);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await generateIcons();
}
