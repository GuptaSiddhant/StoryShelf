// oxlint-disable no-console no-await-in-loop no-promise-executor-return
/**
 * Dev-mode Storybook smoke check: start `storybook dev`, open every story once in a real browser,
 * and fail on a page error, a console error, or Storybook's own error display.
 *
 * `turbo verify` builds Storybook, but the production build tree-shakes code the dev server still
 * evaluates, so a shim or story can pass the build and throw for everyone running
 * `nub run storybook` (#577: `os.tmpdir` and `process.env` at module load). Run from `packages/app`:
 *
 *   nub run smoke:storybook
 *
 * Env: `STORYBOOK_SMOKE_PORT` (default 6016), `STORYBOOK_SMOKE_BROWSER_CHANNEL` (e.g. `chrome` to
 * use an installed Chrome instead of Playwright's Chromium), `STORYBOOK_SMOKE_CONCURRENCY` (default 4).
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const PORT = Number(process.env.STORYBOOK_SMOKE_PORT ?? 6016);
const CONCURRENCY = Number(process.env.STORYBOOK_SMOKE_CONCURRENCY ?? 4);
const BASE = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 240_000;
const STORY_TIMEOUT_MS = 60_000;

/** URLs whose failure is not a story's fault: Chrome asks every new origin for a favicon the dev server lacks. */
const IGNORED_URLS = [/\/favicon\.ico$/u];

function startServer() {
  const server = spawn("storybook", ["dev", "--ci", "--no-open", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.resume();
  server.stderr?.resume();
  return server;
}

async function ready() {
  try {
    return (await fetch(`${BASE}/index.json`)).ok;
  } catch {
    return false;
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`storybook dev exited early with code ${String(server.exitCode)}`);
    }
    if (await ready()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`storybook dev did not answer on ${BASE} within ${START_TIMEOUT_MS / 1000}s`);
}

async function storyIds() {
  const index = await (await fetch(`${BASE}/index.json`)).json();
  return Object.values(index.entries)
    .filter((entry) => entry.type === "story")
    .map((entry) => entry.id);
}

/** Open one story and collect what went wrong while it rendered. */
async function check(browser, id) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const { url } = message.location();
    if (message.type() === "error" && !IGNORED_URLS.some((ignored) => ignored.test(url))) {
      errors.push(`console: ${message.text().slice(0, 300)}${url ? ` (${url})` : ""}`);
    }
  });
  try {
    await page.goto(`${BASE}/iframe.html?viewMode=story&id=${id}`, { timeout: STORY_TIMEOUT_MS });
    // Storybook marks the body once the story rendered (`sb-show-main`) or failed (`sb-show-errordisplay`).
    await page.waitForFunction(
      () => /sb-show-(?:main|errordisplay)/u.test(document.body.className),
      undefined,
      { timeout: STORY_TIMEOUT_MS },
    );
    if (await page.evaluate(() => document.body.classList.contains("sb-show-errordisplay"))) {
      errors.push(`storybook: ${await page.locator("#error-message").innerText()}`);
    }
    await page.waitForTimeout(200);
  } catch (error) {
    errors.push(`smoke: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await page.close();
  }
  return errors.length > 0 ? { id, errors } : null;
}

/** Check every story, `CONCURRENCY` at a time. */
async function checkAll(browser, ids) {
  const failures = [];
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const failure = await check(browser, id);
      if (failure) {
        failures.push(failure);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return failures;
}

function report(total, failures) {
  for (const failure of failures.toSorted((a, b) => a.id.localeCompare(b.id))) {
    console.error(`FAIL ${failure.id}`);
    for (const error of failure.errors) {
      console.error(`  ${error}`);
    }
  }
  console.log(`${total - failures.length}/${total} stories rendered in the dev server`);
}

async function main() {
  const server = startServer();
  try {
    await waitForServer(server);
    const ids = await storyIds();
    const channel = process.env.STORYBOOK_SMOKE_BROWSER_CHANNEL;
    const browser = await chromium.launch(channel ? { channel } : {});
    try {
      const failures = await checkAll(browser, ids);
      report(ids.length, failures);
      return failures.length === 0 && ids.length > 0 ? 0 : 1;
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

process.exitCode = await main();
