/**
 * Browser golden path against the running Fly container (issue #941; gated by `SHELF_E2E=1`).
 *
 * The Fly dry run (`.github/workflows/fly-dry-run.yml`, `e2e: true`) has already booted the
 * production image with password sign-in, a confirmed `SHELF_PUBLIC_BASE_URL` and the read-only demo
 * account, and run `apps/fly-app/seed.sh`. The demo seeds no project of its own (#1275), so this spec
 * creates one with the admin token, uploads a baseline and one changed build, signs in, reviews it
 * with the keyboard, checks the git status the verdict produced (the `git-log` provider, read from
 * `docker logs`), checks the private build stays private and opens its Storybook, signs in as the
 * demo account and checks it is read-only, and runs axe on every app page visited.
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
const enabled = env["SHELF_E2E"] === "1";
const repoRoot = resolve(import.meta.dirname, "../../..");

const BASE = env["SHELF_URL"] ?? "http://127.0.0.1:3000";
const SHELF_ADMIN_TOKEN = env["SHELF_ADMIN_TOKEN"] ?? "";
const EMAIL = env["E2E_EMAIL"] ?? "";
const PASSWORD = env["E2E_PASSWORD"] ?? "";
const DEMO_EMAIL = "demo@storyshelf.js.org";
const DEMO_PASSWORD = env["E2E_DEMO_PASSWORD"] ?? "";
/** The demo project the read-only account is a viewer of (`demo-viewer.ts`). */
const DEMO_SLUG = "storyshelf-ui";
const CONTAINER = env["E2E_CONTAINER"] ?? "storyshelf";
const FIXTURE_STATIC = join(repoRoot, "fixtures/storybook-9/storybook-static");
const CLI = join(repoRoot, "packages/cli/dist/index.js");
/** A failed run leaves its Playwright trace here (CI uploads the folder); a passing run keeps none. */
const TRACE_DIR = env["E2E_TRACE_DIR"] ?? join(repoRoot, ".tmp/e2e-trace");

/** This spec's own project (created in the first test); its `main` build is the baseline. */
let SLUG = "";
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
    headers: { authorization: `Bearer ${SHELF_ADMIN_TOKEN}` },
  });
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  return (await response.json()) as T;
};

const apiPost = async (path: string, body: unknown): Promise<void> => {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SHELF_ADMIN_TOKEN}`, "content-type": "application/json" },
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

/** Upload with the workspace CLI; resolves to the new build's id. */
async function upload(buildDir: string, sha: string, branch = BRANCH): Promise<string> {
  const args = [
    CLI,
    "upload",
    "--url",
    BASE,
    "--slug",
    SLUG,
    "--token",
    SHELF_ADMIN_TOKEN,
    "--sha",
    sha,
    "--branch",
    branch,
    "--build-dir",
    buildDir,
    "--full",
  ];
  const { stdout } = await run(process.execPath, args);
  const id =
    /^\s*Build:\s+(?<id>[0-9A-Z]{26})\s*$/mu.exec(stdout)?.groups?.["id"] ??
    /Build created: (?<id>\w+)/u.exec(stdout)?.groups?.["id"];
  if (!id) throw new Error(`no build id in CLI output: ${stdout}`);
  return id;
}

/** Wait until a build has left the capture queue. */
async function settled(id: string): Promise<void> {
  // One request per tick: `/api/v1` allows 100 requests a minute per client, shared with the CLI.
  await vi.waitFor(
    async () => {
      const build = await api<BuildBody>(`/projects/${SLUG}/builds/${id}`);
      expect(["pending", "capturing", "comparing"]).not.toContain(build.status);
    },
    { timeout: 120_000, interval: POLL_MS },
  );
}

/** Create this spec's project and approve a baseline `main` build of the unchanged fixture. */
async function createProjectWithBaseline(): Promise<void> {
  const response = await fetch(`${BASE}/api/v1/projects`, {
    method: "POST",
    headers: { authorization: `Bearer ${SHELF_ADMIN_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: "E2E golden path",
      gitRepository: "acme/e2e",
      gitDefaultBranch: "main",
      requireVerifiedDefault: false,
    }),
  });
  if (!response.ok) throw new Error(`create project answered ${response.status}`);
  SLUG = ((await response.json()) as { slug: string }).slug;
  // Both shas (this one and the variant's below) must be hex: the API validates them (#1278).
  const baseline = await upload(
    FIXTURE_STATIC,
    `ba5e${Date.now().toString(16)}`.padEnd(40, "0"),
    "main",
  );
  await settled(baseline);
  await apiPost(`/projects/${SLUG}/builds/${baseline}/approve-all`, {});
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
      SHELF_ADMIN_TOKEN && EMAIL && PASSWORD,
      "SHELF_ADMIN_TOKEN, E2E_EMAIL, E2E_PASSWORD",
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

  it("creates a project with a baseline, a git-log channel and a changed build", async () => {
    await createProjectWithBaseline();
    await apiPost(`/projects/${SLUG}/notification-channels`, {
      provider: "git-log",
      config: {},
      secret: "unused-by-git-log",
    });
    const variant = join(scratch, "variant");
    await writeVariant(variant);
    buildId = await upload(variant, sha);
    await settled(buildId);
    const snaps = await api<Snapshot[]>(`/projects/${SLUG}/builds/${buildId}/snapshots`);
    expect(snaps.filter((snap) => snap.status === "changed").map((snap) => snap.storyId)).toEqual([
      CHANGED_STORY,
    ]);
  }, 300_000);

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
    // The build page is the review workspace: the header counts the changes still waiting for a
    // verdict (one here), and the comparison of the selected change is on the page itself.
    await page.getByRole("button", { name: "Approve remaining 1", exact: true }).waitFor();
    await expectAccessible("build page");

    await page
      .getByRole("group", { name: /screenshot$/iu })
      .first()
      .waitFor({ state: "visible" });
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

  it("keeps a private build private, and opens its Storybook once signed in", async () => {
    // The project is private (no `publicBranchRegex`): an anonymous visitor gets neither the build's
    // Storybook nor its settings.
    const project = await api<{ publicBranchRegex: string | null }>(`/projects/${SLUG}`);
    expect(project.publicBranchRegex).toBeNull();
    const anonymous = await fetch(`${BASE}/_/${buildId}/`, { redirect: "manual" });
    expect(anonymous.status).not.toBe(200);
    expect(await anonymous.text()).not.toContain("sb-manager");

    const settings = await fetch(`${BASE}/projects/${SLUG}/settings`, { redirect: "manual" });
    expect(settings.status).toBe(302);
    expect(settings.headers.get("location")).toMatch(/^\/auth\/login\?return_to=/u);

    await page.goto(`${BASE}/projects/${SLUG}/builds/${buildId}`);
    await page.getByLabel("More build actions").click();
    await page.getByRole("menuitem", { name: /^Open Storybook/u }).click();
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

  it("signs in as the read-only demo account: sees storyshelf-ui, cannot write", async () => {
    expect(DEMO_PASSWORD, "E2E_DEMO_PASSWORD").toBeTruthy();
    const demo = await browser.newContext();
    try {
      const view = await demo.newPage();
      await view.goto(`${BASE}/auth/login`);
      await view.getByLabel("Email").fill(DEMO_EMAIL);
      await view.getByLabel("Password").fill(DEMO_PASSWORD);
      await view.getByRole("button", { name: "Sign in", exact: true }).click();
      await view.waitForURL(`${BASE}/`);

      // The server adds the membership once `storyshelf-ui` exists (`demo-viewer.ts`, each minute).
      await vi.waitFor(
        async () => {
          await view.goto(`${BASE}/`);
          await view.getByText(DEMO_SLUG).first().waitFor({ state: "visible", timeout: 1000 });
        },
        { timeout: 120_000, interval: 5000 },
      );
      // Only that project: this spec's own project is not listed for the demo account.
      expect(await view.getByText("E2E golden path").count()).toBe(0);

      // Writes with the demo account's own session (same origin, so only its role can refuse).
      const write = (path: string, body: string, headers: Record<string, string> = {}) =>
        view.evaluate(
          async ([url, data, extra]) =>
            (
              await fetch(url as string, {
                method: "POST",
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                  ...(extra as object),
                },
                body: data as string,
              })
            ).status,
          [`${BASE}${path}`, body, headers] as const,
        );
      await view.goto(`${BASE}/profile`);
      const csrf = (await view.content()).match(/name="csrf_token"\s+value="([^"]+)"/u)?.[1] ?? "";
      expect(await write("/profile", `name=Changed&csrf_token=${csrf}`)).toBe(403);
      expect(await write(`/api/v1/projects/${DEMO_SLUG}/builds/none/comments`, "body=hi")).toBe(
        403,
      );
    } finally {
      await demo.close();
    }
  }, 180_000);
});
