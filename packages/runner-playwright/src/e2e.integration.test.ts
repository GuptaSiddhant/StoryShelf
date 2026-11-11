/**
 * Golden-path end-to-end test in a real browser (issue #941; gated: `nub run test:integration`).
 *
 * One flow through the real app, the built CLI and the real capture pipeline:
 * boot (auth, testing, SQLite, local storage, fixed origin) → project and a `git-log` channel
 * through the API → sign in, then the CI token from the Settings page (a token minted with the
 * admin bearer has no owner and is a viewer, so it cannot upload) → baseline upload to `main` →
 * a visually changed variant on a feature branch → review in Chromium (build page, comparison,
 * approve with `a`) → the private build's Storybook as the signed-in viewer → axe on every
 * visited app page.
 *
 * Every wait is on API state (`vi.waitFor` around a read); there are no timers and no retries.
 * Runs against `fixtures/storybook-9` (`FIXTURE_DIR`), built on demand like the other suites.
 */
import { serve } from "@hono/node-server";
import { createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import {
  axeInjectionScript,
  inPageRunAxe,
  loadAxeSource,
  resolveA11yRun,
} from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { gitNotifiers } from "@storyshelf/notify-git";
import { createLocalStorage } from "@storyshelf/storage-local";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlaywrightCaptureRunner } from "./index.ts";
import { FIXTURE_STATIC_DIR } from "./integration-harness.ts";

const run = promisify(execFile);
const enabled = process.env["RUN_INTEGRATION"] === "1";
const repoRoot = resolve(import.meta.dirname, "../../..");
const cliBin = join(repoRoot, "packages/cli/dist/index.js");

/** Where a failed run leaves its Playwright trace (CI uploads this folder as an artifact). */
const traceDir = process.env["E2E_TRACE_DIR"] ?? join(repoRoot, ".tmp/e2e-trace");

const ADMIN_TOKEN = "e2e-admin-token";
const SECRET = "e2e-secret-that-is-long-enough-1234567890";
const EMAIL = "reviewer@example.com";
const PASSWORD = "e2e-password-123";
/** The story the variant changes; every other story renders as before. */
const CHANGED_STORY = "components-button--secondary";

interface Snap {
  id: string;
  storyId: string;
  status: string;
}
interface BuildBody {
  id: string;
  status: string;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => {
    probe.listen(0, "127.0.0.1", done);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((done) => {
    probe.close(() => {
      done();
    });
  });
  return port;
}

/** The built Storybook with one story's stage painted differently (a CSS patch keyed by story id). */
async function changedVariant(into: string): Promise<void> {
  await cp(FIXTURE_STATIC_DIR, into, { recursive: true });
  const file = join(into, "iframe.html");
  const patch =
    `<script>document.documentElement.dataset.story=new URLSearchParams(location.search).get("id")</script>` +
    `<style>html[data-story="${CHANGED_STORY}"] body{background:#fde047!important}</style>`;
  const html = await readFile(file, "utf8");
  await writeFile(file, html.replace("</head>", `${patch}</head>`));
}

describe.skipIf(!enabled)("golden path, end to end", () => {
  let dir = "";
  let base = "";
  let shelf: { stop: () => Promise<void> } | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let logFile = "";
  let slug = "";
  let ciToken = "";
  let changedBuildId = "";
  let page: Page;
  let failed = false;

  const api = async <T>(path: string, init: RequestInit = {}, token = ADMIN_TOKEN): Promise<T> => {
    const response = await fetch(`${base}/api/v1${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${init.method ?? "GET"} ${path} answered ${response.status}: ${detail}`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  };

  const upload = async (buildDir: string, sha: string, branch: string): Promise<string> => {
    const { stdout } = await run(
      process.execPath,
      [
        cliBin,
        "upload",
        "--url",
        base,
        "--slug",
        slug,
        "--token",
        ciToken,
        "--sha",
        sha,
        "--branch",
        branch,
        "--build-dir",
        buildDir,
        "--full",
      ],
      { env: { ...process.env, CI: "true" } },
    );
    const id = /Build created: (?<id>\w+)/u.exec(stdout)?.groups?.["id"];
    if (!id) throw new Error(`no build id in CLI output: ${stdout}`);
    return id;
  };

  /** Wait on API state until the build has left the pipeline; resolves to its final body. */
  const settled = async (id: string): Promise<BuildBody> => {
    let build: BuildBody | undefined;
    await vi.waitFor(
      async () => {
        build = await api<BuildBody>(`/projects/${slug}/builds/${id}`, {}, ciToken);
        expect(["pending", "capturing", "comparing"]).not.toContain(build.status);
      },
      { timeout: 180_000, interval: 250 },
    );
    return build as BuildBody;
  };

  const snapshots = async (id: string): Promise<Snap[]> =>
    await api<Snap[]>(`/projects/${slug}/builds/${id}/snapshots`, {}, ciToken);

  /** Run axe on the page as it is now; only serious and critical violations fail the test. */
  const expectAccessible = async (name: string): Promise<void> => {
    await page.evaluate(axeInjectionScript(await loadAxeSource()));
    const found = await page.evaluate(inPageRunAxe, resolveA11yRun(null));
    const blocking = found.filter((one) => one.impact === "serious" || one.impact === "critical");
    expect(blocking, `axe on ${name}`).toEqual([]);
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "storyshelf-e2e-"));
    logFile = join(dir, "server.log");
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const database = createSqliteDatabase(join(dir, "shelf.db"));
    const app = createShelfApp({
      database,
      storage: createLocalStorage(join(dir, "data")),
      testing: { runner: createPlaywrightCaptureRunner() },
      notifications: { notifiers: gitNotifiers },
      auth: createShelfAuth({ db: database, secret: SECRET, baseURL: base }).adapter,
      logger: createShelfLogger({
        level: "info",
        transports: [{ target: "pino/file", options: { destination: logFile } }],
      }),
      config: {
        secret: SECRET,
        adminToken: ADMIN_TOKEN,
        publicBaseUrl: base,
        scratchDir: join(dir, "scratch"),
      },
    });
    await app.lifecycle.setup();
    await ensurePasswordAdmin(database, { email: EMAIL, password: PASSWORD });
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
    await new Promise<void>((done) => server.once("listening", done));
    shelf = {
      stop: async () => {
        await app.lifecycle.teardown();
        server.close();
      },
    };
    browser = await chromium.launch();
    context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
  }, 120_000);

  afterEach((task) => {
    failed ||= task.task.result?.state === "fail";
  });

  afterAll(async () => {
    // A trace is kept only for a failed run: a passing one is thrown away.
    await context?.tracing.stop(failed ? { path: join(traceDir, "trace.zip") } : {});
    await context?.close();
    await browser?.close();
    await shelf?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("sets up a project and a git-log channel through the API", async () => {
    const project = await api<{ slug: string }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Golden path", gitDefaultBranch: "main" }),
    });
    slug = project.slug;
    const channel = await api<{ provider: string }>(`/projects/${slug}/notification-channels`, {
      method: "POST",
      body: JSON.stringify({ provider: "git-log", config: {}, secret: "unused-by-git-log" }),
    });
    expect(channel.provider).toBe("git-log");
  });

  it("signs in and creates the CI token on the Settings page", async () => {
    await page.goto(`${base}/auth/login`);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await expectAccessible("sign-in");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${base}/`);

    await page.goto(`${base}/projects/${slug}/settings/tokens`);
    await page.getByLabel("Name").fill("ci");
    await page.getByRole("button", { name: "Create token" }).click();
    ciToken = ((await page.locator("code").first().textContent()) ?? "").trim();
    expect(ciToken).not.toBe("");
    await expectAccessible("token settings");
  });

  it("uploads the baseline to main and waits until it is approved with baselines", async () => {
    const id = await upload(FIXTURE_STATIC_DIR, "a".repeat(40), "main");
    const build = await settled(id);
    expect(build.status).toBe("approved");
    const snaps = await snapshots(id);
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.every((snap) => snap.status === "new" || snap.status === "approved")).toBe(true);
  }, 240_000);

  it("uploads a variant to a feature branch with exactly one changed snapshot", async () => {
    const variant = join(dir, "variant");
    await changedVariant(variant);
    changedBuildId = await upload(variant, "b".repeat(40), "feature/e2e");
    await settled(changedBuildId);
    const changed = (await snapshots(changedBuildId)).filter((snap) => snap.status === "changed");
    expect(changed.map((snap) => snap.storyId)).toEqual([CHANGED_STORY]);
  }, 240_000);

  it("reviews in the browser: build page, comparison, approve with the keyboard", async () => {
    await page.goto(`${base}/projects/${slug}/builds/${changedBuildId}`);
    const label = page.getByText(/changed \/ new/iu);
    await label.waitFor({ state: "visible" });
    expect(((await label.locator("xpath=..").textContent()) ?? "").trim()).toMatch(/^1(?!\d)/u);
    await expectAccessible("build page");

    await page.getByRole("link", { name: "Review diffs" }).click();
    await page.locator("[data-compare]").first().waitFor({ state: "visible" });
    await expectAccessible("comparison");
    await page.keyboard.press("a");
    await page
      .locator("[data-toast-region]")
      .getByText(/^Approved/u)
      .waitFor();

    await vi.waitFor(async () => {
      const after = await snapshots(changedBuildId);
      expect(after.find((snap) => snap.storyId === CHANGED_STORY)?.status).toBe("approved");
    });
    const build = await api<BuildBody>(`/projects/${slug}/builds/${changedBuildId}`, {}, ciToken);
    expect(build.status).toBe("approved");
  }, 120_000);

  it("recorded the build state with the git-log provider, without an outbound call", async () => {
    await vi.waitFor(async () => {
      const lines = (await readFile(logFile, "utf8")).split("\n");
      const states = lines.filter((line) => line.includes("git state (log)"));
      expect(states.some((line) => line.includes("success"))).toBe(true);
    });
  });

  it("opens the private build's Storybook as the signed-in viewer", async () => {
    await page.goto(`${base}/projects/${slug}/builds/${changedBuildId}`);
    await page.getByRole("link", { name: "View Storybook" }).first().click();
    await page.waitForURL(new RegExp(`/_/${changedBuildId}/`, "u"));
    const preview = page.frameLocator("iframe#storybook-preview-iframe");
    await preview.locator("#storybook-root > *").first().waitFor({ state: "visible" });

    // The build served is the variant: its patched story paints the stage.
    await page.goto(`${base}/_/${changedBuildId}/?path=/story/${CHANGED_STORY}`);
    const story = page.frameLocator("iframe#storybook-preview-iframe");
    await story.locator("#storybook-root button").waitFor({ state: "visible" });
    const frame = page.frames().find((one) => one.url().includes("iframe.html"));
    const paint = await frame
      ?.locator("body")
      .evaluate((body) => body.ownerDocument.defaultView?.getComputedStyle(body).backgroundColor);
    expect(paint).toBe("rgb(253, 224, 71)");
  });
});
