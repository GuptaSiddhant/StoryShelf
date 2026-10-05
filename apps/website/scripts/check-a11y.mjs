// oxlint-disable no-console unicorn/no-process-exit no-await-in-loop
// Serves dist/ and runs axe-core (WCAG 2 A/AA) on a sample of pages in light, dark and mobile.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const dist = join(process.cwd(), "dist");
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);
const PAGES = [
  "/",
  "/guides/getting-started/",
  "/guides/review/",
  "/concepts/builds/",
  "/packages/core/",
  "/changelog/",
];
const MODES = [
  { name: "light", theme: "light", viewport: { width: 1280, height: 800 } },
  { name: "dark", theme: "dark", viewport: { width: 1280, height: 800 } },
  { name: "mobile", theme: "dark", viewport: { width: 375, height: 812 } },
];
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};

function serve() {
  const server = createServer((req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (path.endsWith("/")) path += "index.html";
    try {
      const body = readFileSync(join(dist, path));
      res
        .writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" })
        .end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function audit(browser, base, mode, path) {
  const context = await browser.newContext({ viewport: mode.viewport, reducedMotion: "reduce" });
  await context.addInitScript(
    (theme) => localStorage.setItem("starlight-theme", theme),
    mode.theme,
  );
  const page = await context.newPage();
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: "*,*::before,*::after{transition:none!important;animation:none!important}",
  });
  await page.evaluate(axeSource);
  const { violations } = await page.evaluate(() =>
    globalThis.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }),
  );
  await context.close();
  return violations.map(
    (v) => `${mode.name} ${path} ${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(" ")}`,
  );
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const failures = [];
for (const mode of MODES) {
  for (const path of PAGES) failures.push(...(await audit(browser, base, mode, path)));
}
await browser.close();
server.close();
if (failures.length > 0) {
  console.error(`Accessibility violations:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`axe: no WCAG A/AA violations on ${PAGES.length} pages x ${MODES.length} modes`);
