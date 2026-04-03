import { promises as fs } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const ROOT = process.cwd();
const SOURCE_SVG = path.join(ROOT, "static", "assets", "logo.svg");
const OUTPUT_DIR = path.join(ROOT, "static", "assets", "icons");
const ICON_SIZES = [16, 32, 48, 128] as const;

async function ensureOutputDir(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function loadSvg(): Promise<string> {
  return fs.readFile(SOURCE_SVG, "utf8");
}

async function writeIcon(svg: string, size: number): Promise<void> {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: size
    }
  });
  const pngData = resvg.render().asPng();
  const outputPath = path.join(OUTPUT_DIR, `icon-${size}.png`);
  await fs.writeFile(outputPath, pngData);
}

async function main(): Promise<void> {
  const svg = await loadSvg();
  await ensureOutputDir();

  for (const size of ICON_SIZES) {
    await writeIcon(svg, size);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
