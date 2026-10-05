// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Regenerates the docs-site screenshots in apps/website/public/screenshots.
 *
 *   nub scripts/screenshots.mjs [app] [site] [--skip-build]
 *
 *   app    projects-list / build-review / diff-review: boots the real app in
 *          memory with seeded demo data and photographs it.
 *   site   home-hero: builds the docs site and photographs its homepage.
 *   (none) both, in that order. The homepage embeds the app screenshots, so
 *          they must be refreshed *before* the site is built.
 *
 *   --skip-build  reuse an existing apps/website/dist for the `site` step.
 *
 * Needs Playwright's Chromium (`npx playwright-core install chromium`).
 */
import { serve } from "@hono/node-server";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
// Workspace packages are imported from source by path: the repo root does not
// have them in node_modules (they are per-package workspace links).
import { createShelfApp } from "../packages/app/src/index.tsx";
import { createShelfLogger } from "../packages/core/src/logger.ts";
import { BaselineModel, BuildModel, ProjectModel, SnapshotModel } from "../packages/core/src/models/index.ts";
import { makeDatabase, makeStorage } from "../packages/core/src/test-helpers/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const websiteDir = join(root, "apps/website");
const distDir = join(websiteDir, "dist");
const outDir = join(websiteDir, "public/screenshots");
mkdirSync(outDir, { recursive: true });

// Mock "component screenshots" so the docs show a believable review, not blank images.
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

function mockPng(variant) {
  const png = new PNG({ width: 640, height: 400 });
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 640; x++) {
      const i = (640 * y + x) << 2;
      const card = x > 60 && x < 580 && y > 60 && y < 340;
      const btn = x > 90 && x < 210 + variant * 18 && y > 280 && y < 320;
      const title = card && y > 100 && y < 112 && x > 90 && x < 360;
      const [r, g, b] = title ? [40, 44, 60] : btn ? [79, 70, 229] : card ? [255, 255, 255] : [238, 240, 246];
      png.data.set([r, g, b, 255], i);
    }
  }
  return PNG.sync.write(png);
}

function diffPng() {
  const png = new PNG({ width: 640, height: 400 });
  for (let i = 0; i < 640 * 400; i++) {
    const x = i % 640;
    const y = Math.floor(i / 640);
    const hit = x > 200 && x < 270 && y > 280 && y < 320;
    png.data.set(hit ? [255, 40, 90, 255] : [245, 245, 245, 255], i * 4);
  }
  return PNG.sync.write(png);
}

async function captureApp() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();

  const project = await new ProjectModel(db).create({
    name: "Demo Design System",
    gitRepository: "acme/design-system",
    gitDefaultBranch: "main",
  });

  const buildModel = new BuildModel(db);
  const build = await buildModel.create(project.id, {
    gitSha: "abc123def4567890abc123def4567890abc12345",
    gitBranch: "feature/new-button",
    authorName: "Alex Doe",
    authorEmail: "alex@example.com",
    message: "feat: add primary button variant with new tokens",
  });
  await buildModel.update(build.id, { status: "reviewing" });

  const snapModel = new SnapshotModel(db);
  const viewport = { name: "desktop", width: 1280, height: 720 };
  const defs = [
    ["Components/Button", "Primary", "changed"],
    ["Components/Button", "Secondary", "unchanged"],
    ["Components/Button", "Disabled", "unchanged"],
    ["Components/Card", "Default", "changed"],
    ["Components/Card", "With Image", "new"],
    ["Components/Input", "Empty", "unchanged"],
    ["Components/Input", "Error", "changed"],
    ["Components/Modal", "Open", "new"],
  ];
  const stories = defs.map(([title, name, status]) => ({
    id: `${title}--${name}`.toLowerCase().replaceAll(/[^a-z]+/gu, "-"),
    name,
    title,
    status,
    importPath: "src/stories.tsx",
  }));
  for (const story of stories) {
    const screenshotPath = `${project.id}/builds/${build.id}/screenshots/${story.id}/${viewport.name}.png`;
    const diffPath = `${project.id}/builds/${build.id}/diffs/${story.id}/${viewport.name}.png`;
    const snap = await snapModel.create(project.id, build.id, {
      storyId: story.id,
      storyName: story.name,
      storyTitle: story.title,
      storyImportPath: story.importPath,
      viewportName: viewport.name,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      screenshotPath,
    });
    const changed = story.status === "changed";
    await storage.write(screenshotPath, mockPng(changed ? 2 : 0));
    if (changed) await storage.write(diffPath, diffPng());
    await snapModel.update(snap.id, {
      status: story.status,
      diffPixels: changed ? 2345 : 0,
      diffRatio: changed ? 0.031 : 0,
      ...(changed ? { diffPath } : {}),
    });
  }

  await buildModel.update(build.id, {
    status: "reviewing",
    snapshotCount: stories.length,
    changedCount: stories.filter((story) => story.status !== "unchanged").length,
    approvedCount: stories.filter((story) => story.status === "unchanged").length,
  });

  // Baselines on main for every story that existed before (new stories have none)
  const baselineModel = new BaselineModel(db, undefined, storage, "test-secret");
  for (const story of stories.filter((item) => item.status !== "new")) {
    const baselinePath = `${project.id}/baselines/main/${story.id}/${viewport.name}.png`;
    const bytes = mockPng(0);
    await storage.write(baselinePath, bytes);
    await baselineModel.upsert(
      project.id,
      story.id,
      viewport.name,
      "main",
      `baseline-${story.id}`,
      baselinePath,
      bytes,
    );
  }

  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  await app.lifecycle.setup();

  const server = serve({ fetch: app.fetch, port: 0 }, () => {});
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 3457;
  const base = `http://localhost:${port}`;

  const browser = await chromium.launch();
  try {
    // Projects list
    let page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(outDir, "projects-list.png"), fullPage: true });
    console.log("✓ projects-list.png");
    await page.close();

    // Build detail (snapshot cards + bulk actions)
    page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/projects/${project.slug}/builds/${build.id}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, "build-review.png"), fullPage: true });
    console.log("✓ build-review.png");
    await page.close();

    // Diff review (sticky review bar + baseline | current | diff viewer)
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/projects/${project.slug}/builds/${build.id}/diff`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, "diff-review.png"), fullPage: false });
    console.log("✓ diff-review.png");
    await page.close();

    console.log("App screenshots done ->", outDir);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await app.lifecycle.teardown();
  }
}


/** Build the docs site (embeds the app screenshots, so run after `app`). */
function buildWebsite() {
  console.log("Building the docs site…");
  const result = spawnSync("nub", ["run", "--filter", "website", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Website build failed");
  }
}

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


/** Photograph the built docs homepage. */
async function captureSite() {
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
}

const args = process.argv.slice(2);
const steps = args.filter((arg) => arg === "app" || arg === "site");
const unknown = args.filter((arg) => !["app", "site", "--skip-build"].includes(arg));
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}\nUsage: nub scripts/screenshots.mjs [app] [site] [--skip-build]`);
  process.exit(1);
}
const runApp = steps.length === 0 || steps.includes("app");
const runSite = steps.length === 0 || steps.includes("site");

if (runApp) {
  await captureApp();
}
if (runSite) {
  if (!args.includes("--skip-build")) {
    buildWebsite();
  }
  await captureSite();
}
