// oxlint-disable no-console unicorn/no-process-exit no-await-in-loop max-statements no-undef unicorn/consistent-function-scoping no-promise-executor-return
/**
 * Phone-width and accessibility sweep of the built docs site (`dist/`, run `nub run build` first).
 *
 *   node scripts/a11y-sweep.mjs [--all] [--filter <substring>]
 *
 * For every page, in light and dark at 1280px and at 375px, it runs axe-core and measures whether the
 * page scrolls sideways. It fails on a serious or critical axe violation or any sideways scroll, and
 * lists lesser axe findings without failing. `check-a11y.mjs` (the CI check) audits a small sample;
 * this audits everything except the typedoc reference, which is sampled (the index pages, plus the
 * largest and the first two pages of each kind of each package) because its 1,400 pages share a few
 * templates. `--all` audits the reference exhaustively. `A11Y_BROWSER_CHANNEL=chrome` uses an
 * installed Chrome.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, relative } from "node:path";
import { chromium } from "playwright-core";

const dist = join(process.cwd(), "dist");
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);
const args = process.argv.slice(2);
const ALL = args.includes("--all");
const FILTER = args.includes("--filter") ? args[args.indexOf("--filter") + 1] : "";
const MODES = [
  { name: "light-1280", theme: "light", viewport: { width: 1280, height: 800 } },
  { name: "dark-1280", theme: "dark", viewport: { width: 1280, height: 800 } },
  { name: "light-375", theme: "light", viewport: { width: 375, height: 812 } },
  { name: "dark-375", theme: "dark", viewport: { width: 375, height: 812 } },
];
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/** Every built page as a URL path, e.g. `/guides/review/`. */
function pagePaths(dir = dist) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...pagePaths(full));
    else if (entry.name === "index.html") found.push(`/${relative(dist, dir)}/`.replace("//", "/"));
  }
  return found;
}

const sizeOf = (path) => statSync(join(dist, path, "index.html")).size;

/** The reference pages worth auditing: index pages (depth up to 3), and per kind the largest and the first two. */
function sampleReference(paths) {
  const kinds = new Map();
  const picked = new Set();
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length <= 3) {
      picked.add(path);
      continue;
    }
    const kind = parts.slice(0, 3).join("/");
    kinds.set(kind, [...(kinds.get(kind) ?? []), path]);
  }
  for (const list of kinds.values()) {
    const bySize = list.toSorted((a, b) => sizeOf(b) - sizeOf(a));
    for (const path of [bySize[0], ...list.toSorted().slice(0, 2)]) picked.add(path);
  }
  return [...picked];
}

function pagesToAudit() {
  const all = pagePaths().toSorted();
  const reference = all.filter((path) => path.startsWith("/reference/"));
  const rest = all.filter((path) => !path.startsWith("/reference/"));
  const chosen = [...rest, ...(ALL ? reference : sampleReference(reference))];
  return chosen.filter((path) => path.includes(FILTER)).toSorted();
}

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

/** What to measure in the page: sideways scroll and the elements that cause it. */
function measureOverflow() {
  const width = document.documentElement.clientWidth;
  const over = document.documentElement.scrollWidth - width;
  if (over <= 0) return { over: 0, culprits: [] };
  const clipped = (element) => {
    for (
      let node = element.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (getComputedStyle(node).overflowX !== "visible") return true;
    }
    return false;
  };
  const culprits = [];
  for (const element of document.body.querySelectorAll("*")) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.right > width + 1 && !clipped(element) && culprits.length < 3) {
      culprits.push(`${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}`);
    }
  }
  return { over, culprits };
}

async function audit(page, base, mode, path) {
  // A few pages reload themselves once (the diagram script re-themes them), which interrupts the
  // navigation: wait for the page to settle instead of failing.
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(async (error) => {
    if (!String(error).includes("interrupted by another navigation")) throw error;
    await page.waitForLoadState("networkidle");
  });
  await page.addStyleTag({
    content: "*,*::before,*::after{transition:none!important;animation:none!important}",
  });
  // Code blocks become focusable from a client script after load: wait for it, as check-a11y.mjs does.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("pre")].every(
          (block) => block.scrollWidth <= block.clientWidth || block.hasAttribute("tabindex"),
        ),
      undefined,
      { timeout: 3000 },
    )
    .catch(() => {});
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document);
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      target: v.nodes[0].target.join(" ").slice(0, 90),
      // For a contrast finding, the colours and the ratio of the first node.
      colors: (() => {
        const data = v.nodes[0].any[0]?.data;
        return data?.fgColor ? `${data.fgColor} on ${data.bgColor} = ${data.contrastRatio}` : "";
      })(),
    }));
  });
  const overflow = await page.evaluate(measureOverflow);
  return { mode: mode.name, path, violations, overflow };
}

async function runMode(browser, base, mode, paths) {
  const context = await browser.newContext({ viewport: mode.viewport, reducedMotion: "reduce" });
  await context.addInitScript(
    (theme) => localStorage.setItem("starlight-theme", theme),
    mode.theme,
  );
  const page = await context.newPage();
  const results = [];
  for (const path of paths) {
    // One retry: a navigation can be interrupted when the machine is busy.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        results.push(await audit(page, base, mode, path));
        break;
      } catch (error) {
        if (attempt === 2) {
          results.push({ mode: mode.name, path, error: String(error).slice(0, 400) });
        }
      }
    }
  }
  await context.close();
  return results;
}

/** Group findings by rule and first selector so a template defect shows once with its page count. */
function summarize(results) {
  const groups = new Map();
  const add = (key, detail, where) => {
    const group = groups.get(key) ?? { detail, where: new Set() };
    group.where.add(where);
    groups.set(key, group);
  };
  for (const result of results) {
    if (result.error) add(`error: ${result.error}`, "", `${result.mode} ${result.path}`);
    for (const v of result.violations ?? []) {
      add(
        `${v.impact} ${v.id} ${v.target}`,
        `${v.nodes} node(s)${v.colors ? `, ${v.colors}` : ""}`,
        `${result.mode} ${result.path}`,
      );
    }
    if (result.overflow?.over > 0) {
      add(
        `SIDEWAYS ${result.overflow.culprits.join(" | ")}`,
        `+${result.overflow.over}px`,
        `${result.mode} ${result.path}`,
      );
    }
  }
  return groups;
}

const paths = pagesToAudit();
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const channel = process.env["A11Y_BROWSER_CHANNEL"];
const browser = await chromium.launch(channel ? { channel } : {});
const results = (
  await Promise.all(MODES.map((mode) => runMode(browser, base, mode, paths)))
).flat();
await browser.close();
server.close();

const groups = summarize(results);
let failed = 0;
for (const [key, group] of [...groups].toSorted((a, b) => b[1].where.size - a[1].where.size)) {
  const blocking = /^(serious|critical|SIDEWAYS|error)/u.test(key);
  if (blocking) failed += 1;
  const sample = [...group.where].slice(0, 2).join("; ");
  console.log(
    `${blocking ? "FAIL" : "note"} ${key} [${group.detail}] x${group.where.size}: ${sample}`,
  );
}
console.log(
  `${paths.length} pages x ${MODES.length} modes${ALL ? " (every page)" : ""}: ${failed} blocking finding(s), ${groups.size - failed} note(s)`,
);
process.exit(failed > 0 ? 1 : 0);
