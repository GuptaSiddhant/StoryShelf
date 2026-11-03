// Run once on the Sprite before the checkpoint: opens a browser, renders text in several fonts
// and a screenshot, and closes it, so the font cache and the browser's profile files are warm
// when the checkpoint is taken.
import { chromium } from "playwright-core";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.setContent(
  `<body style="font:16px sans-serif">${["serif", "sans-serif", "monospace", "cursive", "system-ui"]
    .map((family) => `<p style="font-family:${family}">warm up ${family} 0123456789</p>`)
    .join("")}</body>`,
);
const bytes = (await page.screenshot()).length;
await browser.close();
process.stdout.write(`warmed: chromium, screenshot ${bytes} bytes\n`);
