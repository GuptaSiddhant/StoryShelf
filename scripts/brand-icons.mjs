// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Renders the StoryShelf raster icons from the hand-written SVG sources (storyshelf-logo-*.svg) in
 * apps/website/src/assets/brand/ (docs/brand.md), and checks the maskable
 * icon's safe zone.
 *
 *   nub scripts/brand-icons.mjs           render, then check
 *   nub scripts/brand-icons.mjs --check   check only (exit 1 on failure)
 *
 * Writes into apps/website/public/: favicon-16.png, favicon-32.png,
 * favicon.ico (16 + 32), apple-touch-icon.png (180), icon-192.png,
 * icon-512.png and icon-maskable-512.png. Needs Playwright's Chromium.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "apps/website/src/assets/brand");
const publicDir = join(root, "apps/website/public");
const source = (name) => readFileSync(join(brandDir, name), "utf8");

const logo = (name) => () => source(`storyshelf-logo-${name}.svg`);

/**
 * 16 and 32 px use the small drawing (the S plus one enlarged solid story): the
 * three outlined stories blur below about 48 px (docs/brand.md).
 */
const targets = [
  { file: "favicon-16.png", size: 16, svg: logo("purple-white-small") },
  { file: "favicon-32.png", size: 32, svg: logo("purple-white-small") },
  { file: "apple-touch-icon.png", size: 180, svg: logo("purple-white-square") },
  { file: "icon-192.png", size: 192, svg: logo("purple-white-rounded") },
  { file: "icon-512.png", size: 512, svg: logo("purple-white-rounded") },
  { file: "icon-maskable-512.png", size: 512, svg: logo("purple-white-maskable") },
];

async function render(page, svg, size) {
  const sized = svg.replace(/width="\d+" height="\d+"/u, `width="${size}" height="${size}"`);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** An ICO file holding PNG images (Vista+ format; every current browser reads it). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

/**
 * Maskable safe zone (W3C manifest spec): everything that is not the plain
 * background must sit inside a circle of radius 40% of the icon, centred.
 * The one exception is the two boards of the S, which run to the edge of the
 * tile on purpose (docs/brand.md): outside the circle,
 * only pixels in the board rows (scaled 0.8 about the centre) may differ.
 */
async function checkMaskable(page) {
  const png = readFileSync(join(publicDir, "icon-maskable-512.png")).toString("base64");
  const result = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data: px, width, height } = context.getImageData(0, 0, image.width, image.height);
    const bg = [px[0], px[1], px[2]];
    const radius = 0.4 * width;
    const row = (y64) => ((y64 * 0.8 + 6.4) / 64) * height;
    const boards = [
      [row(11), row(16)],
      [row(48), row(53)],
    ];
    const onBoard = (y) => boards.some(([from, to]) => y >= from - 1 && y <= to + 1);
    let outside = 0;
    let farthest = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const differs =
          Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 24;
        if (!differs) continue;
        const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
        farthest = Math.max(farthest, distance);
        if (distance > radius && !onBoard(y)) outside++;
      }
    }
    // The top board runs to the right edge, the bottom board to the left edge.
    const differsAt = (x, [from, to]) => {
      const i = (Math.round((from + to) / 2) * width + x) * 4;
      return Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 24;
    };
    const reachesEdge = differsAt(width - 1, boards[0]) && differsAt(0, boards[1]);
    return { outside, farthest: farthest / width, opaqueCorner: px[3] === 255, reachesEdge };
  }, png);
  const ok = result.outside === 0 && result.opaqueCorner && result.reachesEdge;
  console.log(
    `${ok ? "✓" : "✗"} maskable safe zone: content reaches ${(result.farthest * 100).toFixed(1)}% of the width from the centre (limit 40%, boards excepted), full-bleed background ${result.opaqueCorner ? "yes" : "no"}, boards reach the edge ${result.reachesEdge ? "yes" : "no"}`,
  );
  return ok;
}

const checkOnly = process.argv.includes("--check");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  if (!checkOnly) {
    const rendered = new Map();
    for (const target of targets) {
      const png = await render(page, target.svg(), target.size);
      rendered.set(target.file, png);
      writeFileSync(join(publicDir, target.file), png);
      console.log(`✓ ${target.file}`);
    }
    writeFileSync(
      join(publicDir, "favicon.ico"),
      ico([
        { size: 16, png: rendered.get("favicon-16.png") },
        { size: 32, png: rendered.get("favicon-32.png") },
      ]),
    );
    console.log("✓ favicon.ico");
  }
  if (!(await checkMaskable(page))) process.exitCode = 1;
} finally {
  await browser.close();
}
