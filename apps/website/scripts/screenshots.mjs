// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");
const outDir = join(__dirname, "..", "public", "screenshots");
mkdirSync(outDir, { recursive: true });

const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// file:// leaves the built assets unstyled (root-absolute hrefs never
// resolve), so serve dist/ over loopback instead.
function serveDist() {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const file = join(distDir, path.endsWith("/") ? `${path}index.html` : path);
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0 });
    });
  });
}

const { server, port } = await serveDist();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, "home-hero.png") });
  console.log("✓ home-hero.png");

  await page.close();
  console.log("Homepage screenshots done ->", outDir);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
