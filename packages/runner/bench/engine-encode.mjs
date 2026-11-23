/**
 * Screenshot encode/launch microbenchmark: node --conditions=source bench/engine-encode.mjs <playwright-core entry file URL or "playwright-core"> <storybook url> [reps]
 * Prints JSON: median ms for launch, newPage, viewport screenshot, full-page screenshot, and PNG bytes.
 */
/* oxlint-disable eslint/no-await-in-loop, eslint/no-console, eslint/id-length, eslint/sort-vars, eslint/prefer-named-capture-group -- a sequential benchmark CLI: timings must not overlap, and printing is its output */
const [entry = "playwright-core", base = "http://127.0.0.1:6109", reps = "30"] =
  process.argv.slice(2);
const { chromium } = await import(entry);
const { installSettleRecorder, waitForSettled } = await import("../src/settle.ts");
const med = (a) => a.toSorted((x, y) => x - y)[Math.floor(a.length / 2)];
const t = async (fn) => {
  const s = performance.now();
  const r = await fn();
  return [performance.now() - s, r];
};
const settled = [];
const launches = [],
  pages = [],
  vp = [],
  full = [];
let vpBytes = 0,
  fullBytes = 0;
for (let i = 0; i < 5; i += 1) {
  const [l, browser] = await t(() => chromium.launch({ args: ["--disable-dev-shm-usage"] }));
  launches.push(l);
  try {
    const [p, page] = await t(async () => {
      const c = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      return await c.newPage();
    });
    pages.push(p);
    await installSettleRecorder(page);
    await page.goto(`${base}/iframe.html?id=components-themed--surface&viewMode=story`, {
      waitUntil: "load",
    });
    // Storybook's own render-finished event, bounded; the runner's fixed wait only when it never signals.
    const report = await waitForSettled(page, 5000);
    settled.push(report.settled);
    if (!report.settled) await page.waitForTimeout(500);
    for (let n = 0; n < Number(reps) / 5; n += 1) {
      const [a, b1] = await t(() => page.screenshot({ type: "png" }));
      vp.push(a);
      vpBytes = b1.length;
      const [c, b2] = await t(() => page.screenshot({ type: "png", fullPage: true }));
      full.push(c);
      fullBytes = b2.length;
    }
  } finally {
    await browser.close();
  }
}
console.log(
  JSON.stringify({
    launchMs: med(launches),
    newPageMs: med(pages),
    viewportShotMs: med(vp),
    viewportBytes: vpBytes,
    fullShotMs: med(full),
    fullBytes,
    settledEveryRun: settled.every(Boolean),
  }),
);
