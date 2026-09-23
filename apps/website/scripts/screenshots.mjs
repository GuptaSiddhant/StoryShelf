// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const websiteDist = join(__dirname, "..", "dist", "index.html");
const outDir = join(__dirname, "..", "public", "screenshots");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  await page.goto(`file://${websiteDist}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, "home-hero.png") });
  console.log("✓ home-hero.png");

  await page.close();
  console.log("Homepage screenshots done ->", outDir);
} finally {
  await browser.close();
}
