// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Regenerates the docs-site images.
 *
 *   nub scripts/screenshots.mjs [app] [og]
 *
 *   app   Boots the real app in memory with seeded demo data and photographs
 *         it in light and dark -> apps/website/src/assets/screenshots/
 *         (<name>-light.png / <name>-dark.png, optimised by Astro at build).
 *   og    Renders the social-card image -> apps/website/public/og-image.png
 *         (uses the app screenshots, so it needs `app` to have run once).
 *   (none) both, in that order.
 *
 * Needs Playwright's Chromium (`npx playwright-core install chromium`).
 */
import { serve } from "@hono/node-server";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
// Workspace packages are imported from source by path: the repo root does not
// have them in node_modules (they are per-package workspace links).
import { createShelfApp } from "../packages/app/src/index.tsx";
import { settleInsightJobs } from "../packages/app/src/insights/job.ts";
import { createShelfLogger } from "../packages/core/src/logger.ts";
import {
  BaselineModel,
  BuildModel,
  ProjectModel,
  SnapshotModel,
} from "../packages/core/src/models/index.ts";
import { makeDatabase, makeStorage } from "../packages/core/src/test-helpers/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const websiteDir = join(root, "apps/website");
const shotsDir = join(websiteDir, "src/assets/screenshots");
const ogPath = join(websiteDir, "public/og-image.png");
const logoPath = join(websiteDir, "src/assets/logo.svg");
mkdirSync(shotsDir, { recursive: true });

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
      const [r, g, b] = title
        ? [40, 44, 60]
        : btn
          ? [79, 70, 229]
          : card
            ? [255, 255, 255]
            : [238, 240, 246];
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

/** Deterministic stand-in for the AI surface so the docs show believable insights offline. */
function demoAi() {
  const usage = { inputTokens: 2100, outputTokens: 310, estimated: false };
  const triage = {
    verdict: "needs-review",
    summary:
      "The primary Button gained new spacing and colour tokens, which matches the commit. Card and Input also changed, which the commit does not mention.",
    items: [
      { snapshotKey: "Components/Button/Primary@desktop", note: "Padding and fill match the new tokens.", severity: "info" },
      { snapshotKey: "Components/Input/Error@desktop", note: "Error border colour changed without a matching source change.", severity: "medium" },
    ],
    confidence: "medium",
  };
  const health = {
    verdict: "watch",
    summary:
      "Review load is steady, but Components/Input/Error changed in four of the last twelve builds, which suggests an unstable story or a shared token.",
    score: 78,
    trends: [
      { label: "Review backlog", note: "Median of 3 snapshots per build, flat over the window.", direction: "flat" },
      { label: "Churny stories", note: "Input/Error and Card/Default change most often.", direction: "up" },
    ],
    confidence: "medium",
  };
  return {
    summarize: async (input) => ({
      object: input.task === "health" ? health : triage,
      usage,
      profileRequested: input.profile ?? null,
      profileEffective: input.profile ?? "default",
      model: "demo:model",
      imagesSent: 0,
      visionSkipped: false,
      warnings: [],
    }),
    profileNames: () => ["default", "private-local"],
    defaultProfile: () => "default",
    hasVision: () => false,
    modelId: () => "demo:model",
    budget: () => ({ visionWeight: 5, perProjectCallsPerHour: 50 }),
    limits: () => ({}),
    timeoutMs: () => 60_000,
    setup: async () => {},
    health: async () => ({ ok: true }),
    teardown: async () => {},
  };
}

/** Generate the demo triage and health digest through the real API. */
async function seedInsights(base, slug, buildId) {
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  await post(`/api/v1/projects/${slug}/builds/${buildId}/insights`, {});
  await post(`/api/v1/projects/${slug}/insights/health`, {});
  await settleInsightJobs();
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

  await new ProjectModel(db).update(project.id, { aiProfile: "default" });

  const app = createShelfApp({
    database: db,
    storage,
    ai: demoAi(),
    logger: createShelfLogger({ level: "silent" }),
  });
  await app.lifecycle.setup();

  const server = serve({ fetch: app.fetch, port: 0 }, () => {});
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 3457;
  const base = `http://localhost:${port}`;

  const slug = project.slug;
  await seedInsights(base, slug, build.id);
  const pages = [
    { name: "projects-list", path: "/projects", viewport: { width: 1280, height: 780 } },
    {
      name: "build-review",
      path: `/projects/${slug}/builds/${build.id}`,
      viewport: { width: 1280, height: 860 },
    },
    {
      name: "diff-review",
      path: `/projects/${slug}/builds/${build.id}/diff`,
      viewport: { width: 1440, height: 900 },
    },
    {
      name: "library",
      path: `/projects/${slug}/library?branch=feature/new-button`,
      viewport: { width: 1280, height: 860 },
    },
    {
      name: "ai-settings",
      path: `/projects/${slug}/settings/ai`,
      viewport: { width: 1280, height: 700 },
    },
    {
      name: "project-settings",
      path: `/projects/${slug}/settings/tokens`,
      viewport: { width: 1280, height: 780 },
    },
  ];
  const browser = await chromium.launch();
  try {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ colorScheme: scheme, deviceScaleFactor: 1.5 });
      for (const { name, path, viewport } of pages) {
        const page = await context.newPage();
        await page.setViewportSize(viewport);
        await page.goto(base + path, { waitUntil: "networkidle" });
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(shotsDir, `${name}-${scheme}.png`) });
        console.log(`✓ ${name}-${scheme}.png`);
        await page.close();
      }
      await context.close();
    }
    console.log("App screenshots done ->", shotsDir);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await app.lifecycle.teardown();
  }
}

const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

/** Social card (1200x630): brand, tagline, and the review workspace. */
async function captureOg() {
  const shot = dataUrl(join(shotsDir, "diff-review-dark.png"));
  // Read the mark rather than inlining a copy, so the card cannot drift from
  // the site's logo.
  const logo = `data:image/svg+xml;base64,${readFileSync(logoPath).toString("base64")}`;
  const html = `<!doctype html><html><body style="margin:0;width:1200px;height:630px;overflow:hidden;position:relative;
    background:radial-gradient(900px 500px at 85% 0%,#12254a,transparent 70%),#09090b;color:#fafafa;
    font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
    <div style="position:absolute;left:72px;top:72px;width:480px">
      <div style="display:flex;align-items:center;gap:16px">
        <img src="${logo}" width="56" height="56" alt=""/>
        <div style="font-size:44px;font-weight:700;letter-spacing:-0.02em">StoryShelf</div>
      </div>
      <div style="margin-top:44px;font-size:52px;line-height:1.1;font-weight:700;letter-spacing:-0.03em">
        Visual testing for Storybook, on your own infrastructure.</div>
      <div style="margin-top:28px;font-size:26px;color:#a1a1aa">Self-hosted. Unlimited snapshots.</div>
    </div>
    <img src="${shot}" style="position:absolute;left:600px;top:150px;width:900px;border-radius:14px;
      border:1px solid #27272a;box-shadow:0 30px 80px rgba(0,0,0,.6)"/>
  </body></html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: ogPath });
    console.log("✓ og-image.png");
  } finally {
    await browser.close();
  }
}

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "app" && arg !== "og");
if (unknown.length > 0) {
  console.error(
    `Unknown argument(s): ${unknown.join(", ")}\nUsage: nub scripts/screenshots.mjs [app] [og]`,
  );
  process.exit(1);
}
if (args.length === 0 || args.includes("app")) {
  await captureApp();
}
if (args.length === 0 || args.includes("og")) {
  await captureOg();
}
