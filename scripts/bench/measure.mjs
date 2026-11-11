/** The five measurements of the benchmark (issue #853), each taken from a running `system`. */
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, SLUG } from "./harness.mjs";
import { countByName, round, slowest } from "./instrument.mjs";

/** 2. One capture pass: the orchestrator's timing spans and the 4. database work inside it. */
export async function captureReport(system, buildId, waited, startedAt) {
  const done = await timingsLog(system, buildId);
  const timings = done ? JSON.parse(done.line).timings : {};
  const from = waited.captureStart ?? startedAt;
  const window = done ? system.dbCalls.filter((c) => c.at >= from && c.at <= done.at) : [];
  const snapshots = await snapshotCount(system, buildId);
  const render = timings["capture.render"] ?? 0;
  return {
    status: waited.build.status,
    snapshots,
    wallMs: round((done?.at ?? performance.now()) - startedAt),
    spansMs: timings,
    renderMsPerScreenshot: snapshots ? round(render / snapshots) : null,
    db: {
      queries: window.length,
      byMethod: countByName(window),
      totalMs: round(window.reduce((sum, call) => sum + call.ms, 0)),
      slowest: slowest(window),
    },
  };
}

/** The build turns terminal a moment before the orchestrator logs its timings: wait for the line. */
async function timingsLog(system, buildId, timeoutMs = 10_000) {
  const started = performance.now();
  for (;;) {
    const found = system.logs.find(
      ({ line }) => line.includes(buildId) && line.includes('"capture timings"'),
    );
    if (found || performance.now() - started > timeoutMs) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function snapshotCount(system, buildId) {
  return (await system.snapshots.listByBuild(buildId)).length;
}

/** 3. Load the published Storybook home page and one story in a browser; count storage calls. */
export async function servingReport(system, buildId, storyId) {
  const { chromium } = createRequire(join(root, "packages/runner-playwright/package.json"))(
    "playwright-core",
  );
  const browser = await chromium.launch();
  try {
    const out = {};
    for (const [name, path] of [
      ["home", `/_/${buildId}/`],
      ["story", `/_/${buildId}/iframe.html?id=${storyId}&viewMode=story`],
    ]) {
      const page = await browser.newPage();
      system.storageCalls.length = 0;
      const started = performance.now();
      await page.goto(`${system.base}${path}`, { waitUntil: "networkidle" });
      const wallMs = round(performance.now() - started);
      await page.close();
      out[name] = {
        wallMs,
        storageCalls: system.storageCalls.length,
        byMethod: countByName(system.storageCalls),
      };
    }
    return out;
  } finally {
    await browser.close();
  }
}

/** 5. Response bytes and time for the project, build and component pages. */
export async function pagesReport(system, buildId, importPath) {
  const { createUrlBuilder } = await import(
    pathToFileURL(join(root, "packages/core/dist/urls.mjs")).href
  );
  const urls = createUrlBuilder("");
  const targets = {
    project: urls.project(SLUG),
    build: urls.build(SLUG, buildId),
    component: urls.component(SLUG, importPath),
  };
  const out = {};
  for (const [name, path] of Object.entries(targets)) {
    const started = performance.now();
    const response = await fetch(`${system.base}${path}`, {
      headers: { authorization: "Bearer bench-admin-token" },
    });
    const bytes = (await response.arrayBuffer()).byteLength;
    out[name] = { status: response.status, bytes, ms: round(performance.now() - started) };
  }
  return out;
}
