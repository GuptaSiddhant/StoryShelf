/**
 * Browser golden path against the running Fly container (issue #941; gated by `STORYSHELF_E2E=1`).
 *
 * The Fly dry run (`.github/workflows/fly-dry-run.yml`, `e2e: true`) has already booted the
 * production image with password sign-in and a confirmed `PUBLIC_BASE_URL`, and seeded the demo
 * with `apps/fly-app/seed.sh` (a `main` baseline). This spec adds what a person does next: upload
 * one changed build to a feature branch, sign in, review it with the keyboard, check the git status
 * the verdict produced (the `git-log` provider, read from `docker logs`), open the private build's
 * Storybook, and run axe on every app page visited.
 *
 * Every wait is on API or log state (`vi.waitFor`) or a DOM state; there are no sleeps and no retries.
 */
import {
  axeInjectionScript,
  inPageRunAxe,
  loadAxeSource,
  resolveA11yRun,
} from "@storyshelf/core/capture";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const run = promisify(execFile);
const env = process.env;
const enabled = env["STORYSHELF_E2E"] === "1";
const repoRoot = resolve(import.meta.dirname, "../../..");

const BASE = env["STORYSHELF_URL"] ?? "http://127.0.0.1:3000";
const ADMIN_TOKEN = env["STORYSHELF_ADMIN_TOKEN"] ?? "";
const EMAIL = env["E2E_EMAIL"] ?? "";
const PASSWORD = env["E2E_PASSWORD"] ?? "";
const CONTAINER = env["E2E_CONTAINER"] ?? "storyshelf";
const FIXTURE_STATIC = join(repoRoot, "fixtures/storybook-9/storybook-static");
const CLI = join(repoRoot, "packages/cli/dist/index.js");
/** A failed run leaves its Playwright trace here (CI uploads the folder); a passing run keeps none. */
const TRACE_DIR = env["E2E_TRACE_DIR"] ?? join(repoRoot, ".tmp/e2e-trace");

/** The seeded demo project: its `main` build is the baseline the changed build is compared with. */
const SLUG = "demo-design-system";
const BRANCH = "feature/e2e-golden-path";
/** The story the variant repaints; every other story renders as in the baseline. */
const CHANGED_STORY = "components-button--secondary";
/** Poll interval for API state: the API allows 100 requests a minute per client (shared). */
const POLL_MS = 2000;
const PATCHED_BACKGROUND = "rgb(253, 224, 71)";

interface Snapshot {
  storyId: string;
  status: string;
}
interface BuildBody {
  id: string;
  status: string;
  public: boolean;
}

const api = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  return (await response.json()) as T;
};

const apiPost = async (path: string, body: unknown): Promise<void> => {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} answered ${response.status}: ${await response.text()}`);
  }
};

/** The built fixture with one story's stage repainted by a CSS patch keyed on the story id. */
async function writeVariant(into: string): Promise<void> {
  await cp(FIXTURE_STATIC, into, { recursive: true });
  const file = join(into, "iframe.html");
  const patch =
    `<script>document.documentElement.dataset.story=new URLSearchParams(location.search).get("id")</script>` +
    `<style>html[data-story="${CHANGED_STORY}"] body{background:#fde047!important}</style>`;
  await writeFile(file, (await readFile(file, "utf8")).replace("</head>", `${patch}</head>`));
}

/** Upload with the workspace CLI, as the seed does; resolves to the new build's id. */
async function upload(buildDir: string, sha: string): Promise<string> {
  const args = [
    CLI,
    "upload",
    "--url",
    BASE,
    "--slug",
    SLUG,
    "--token",
    ADMIN_TOKEN,
    "--sha",
    sha,
    "--branch",
    BRANCH,
    "--build-dir",
    buildDir,
    "--full",
  ];
  const { stdout } = await run(process.execPath, args);
  const id = /Build created: (?<id>\w+)/u.exec(stdout)?.groups?.["id"];
  if (!id) throw new Error(`no build id in CLI output: ${stdout}`);
  return id;
}

/** The structured `git state (log)` records in the container's log, as parsed objects. */
async function gitStates(): Promise<{ state: string; target: { sha: string; context: string } }[]> {
  const { stdout, stderr } = await run("docker", ["logs", CONTAINER], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${stdout}\n${stderr}`
    .split("\n")
    .filter((line) => line.startsWith("{") && line.includes("git state (log)"))
    .map((line) => JSON.parse(line) as { msg: string; state: string; target: never })
    .filter((record) => record.msg === "git state (log)");
}

describe.skipIf(!enabled)("golden path in a browser, on the Fly container", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let scratch = "";
  let buildId = "";
  const sha = `e2e${Date.now().toString(16)}`.padEnd(40, "0");
  let failed = false;

  /** Run axe on the page as it is now; only serious and critical violations fail. */
  const expectAccessible = async (name: string): Promise<void> => {
    await page.evaluate(axeInjectionScript(await loadAxeSource()));
    const found = await page.evaluate(inPageRunAxe, resolveA11yRun(null));
    const blocking = found.filter((one) => one.impact === "serious" || one.impact === "critical");
    expect(blocking, `axe on ${name}`).toEqual([]);
  };

  beforeAll(async () => {
    expect(
      ADMIN_TOKEN && EMAIL && PASSWORD,
      "STORYSHELF_ADMIN_TOKEN, E2E_EMAIL, E2E_PASSWORD",
    ).toBeTruthy();
    scratch = await mkdtemp(join(tmpdir(), "storyshelf-e2e-"));
    browser = await chromium.launch();
    context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
  }, 60_000);

  afterEach((task) => {
    failed ||= task.task.result?.state === "fail";
  });

  afterAll(async () => {
    // A trace is kept only for a failed run.
    await context?.tracing.stop(failed ? { path: join(TRACE_DIR, "trace.zip") } : {});
    await context?.close();
    await browser?.close();
    await rm(scratch, { recursive: true, force: true });
  });

  it("creates a git-log channel and uploads a changed build to a feature branch", async () => {
    await apiPost(`/projects/${SLUG}/notification-channels`, {
      provider: "git-log",
      config: {},
      secret: "unused-by-git-log",
    });
    const variant = join(scratch, "variant");
    await writeVariant(variant);
    buildId = await upload(variant, sha);

    // One request per tick: `/api/v1` allows 100 requests a minute per client, shared with the CLI.
    await vi.waitFor(
      async () => {
        const build = await api<BuildBody>(`/projects/${SLUG}/builds/${buildId}`);
        expect(["pending", "capturing", "comparing"]).not.toContain(build.status);
      },
      { timeout: 120_000, interval: POLL_MS },
    );
    const snaps = await api<Snapshot[]>(`/projects/${SLUG}/builds/${buildId}/snapshots`);
    expect(snaps.filter((snap) => snap.status === "changed").map((snap) => snap.storyId)).toEqual([
      CHANGED_STORY,
    ]);
  }, 180_000);

  it("signs in through the login page", async () => {
    await page.goto(`${BASE}/auth/login`);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await expectAccessible("sign-in");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${BASE}/`);
  }, 60_000);

  it("reviews the changed build: count, comparison, approve with the keyboard", async () => {
    await page.goto(`${BASE}/projects/${SLUG}/builds/${buildId}`);
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

    await vi.waitFor(
      async () => {
        const snaps = await api<Snapshot[]>(`/projects/${SLUG}/builds/${buildId}/snapshots`);
        expect(snaps.find((snap) => snap.storyId === CHANGED_STORY)?.status).toBe("approved");
      },
      { timeout: 30_000, interval: POLL_MS },
    );
    expect((await api<BuildBody>(`/projects/${SLUG}/builds/${buildId}`)).status).toBe("approved");
  }, 120_000);

  it("recorded a success status for the build's commit (git-log, no outbound call)", async () => {
    await vi.waitFor(
      async () => {
        const records = await gitStates();
        expect(
          records.some(
            (record) =>
              record.state === "success" &&
              record.target.sha === sha &&
              record.target.context.endsWith("/testing"),
          ),
        ).toBe(true);
      },
      { timeout: 60_000, interval: 500 },
    );
  });

  it("serves the private build's Storybook to the signed-in viewer only", async () => {
    expect((await api<BuildBody>(`/projects/${SLUG}/builds/${buildId}`)).public).toBe(false);
    const anonymous = await fetch(`${BASE}/_/${buildId}/`, { redirect: "manual" });
    expect(anonymous.status).not.toBe(200);

    await page.goto(`${BASE}/projects/${SLUG}/builds/${buildId}`);
    await page.getByRole("link", { name: "View Storybook" }).first().click();
    await page.waitForURL(new RegExp(`/_/${buildId}/`, "u"));
    await page
      .frameLocator("iframe#storybook-preview-iframe")
      .locator("#storybook-root > *")
      .first()
      .waitFor({ state: "visible" });

    // It is the variant that was uploaded: the patched story paints the stage.
    await page.goto(`${BASE}/_/${buildId}/?path=/story/${CHANGED_STORY}`);
    await page
      .frameLocator("iframe#storybook-preview-iframe")
      .locator("#storybook-root button")
      .waitFor({ state: "visible" });
    const frame = page.frames().find((one) => one.url().includes("iframe.html"));
    const paint = await frame
      ?.locator("body")
      .evaluate((body) => body.ownerDocument.defaultView?.getComputedStyle(body).backgroundColor);
    expect(paint).toBe(PATCHED_BACKGROUND);
  }, 60_000);
});
