/**
 * Sandboxed Storybook hosting in a real browser (ADR 0051, #357 acceptance): an uploaded Storybook
 * served by the app in `storybookHosting: { mode: "sandboxed" }` runs scripts, but on an opaque origin
 * with no access to the portal's DOM, storage or cookies, whether it is framed by an app page or
 * opened directly. A private build is read through a `/_r/` grant, because the sandboxed page sends no
 * cookie. Run once per fixture with `FIXTURE_DIR` (Storybook 8, 9 and 10). Gated by
 * `RUN_INTEGRATION=1` like the rest.
 */
import { serve } from "@hono/node-server";
import { createShelfApp } from "@storyshelf/app";
import type { Auth } from "@storyshelf/core/auth";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext, Frame, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureFixtureBuilt, readJson, uploadBuild } from "./integration-harness.ts";

const STORY = "components-button--primary";
const SECRET = "sandbox-isolation-secret-0123456789";
const SESSION = { name: "sid", value: "ok" };
const user = { id: "u1", email: "ada@example.com", name: "Ada", role: "admin" as const };

/**
 * A session is the `sid` cookie. The in-process requests that create and upload the project carry no
 * `Sec-Fetch-Site`, a browser request always does, so only a browser needs the cookie. That keeps the
 * test honest: a sandboxed page sends no cookie, so anything it loads must not need one.
 */
const cookieAuth = {
  handler: () => Promise.resolve(new Response("Not Found", { status: 404 })),
  loginMethods: () => [],
  setup: () => Promise.resolve(),
  issueInvite: () => Promise.reject(new Error("not used")),
  verifyInvite: () => Promise.reject(new Error("not used")),
  acceptInvite: () => Promise.reject(new Error("not used")),
  passkeysEnabled: () => false,
  listSessions: () => Promise.resolve([]),
  listPasskeys: () => Promise.resolve([]),
  hasPassword: () => Promise.resolve(false),
  setDisabled: () => Promise.resolve(),
  createSession: () => Promise.resolve("ok"),
  destroySession: () => Promise.resolve(),
  check: (request: Request) =>
    Promise.resolve(
      request.headers.get("cookie")?.includes(`${SESSION.name}=${SESSION.value}`) ||
        !request.headers.has("sec-fetch-site")
        ? user
        : null,
    ),
} as unknown as Auth;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  });
}

/** What a page can do to the origin that serves it, evaluated inside the frame under test. */
interface Reach {
  origin: string;
  storage: string;
  cookie: string;
  parent: string;
  api: string;
  /** A no-CORS sub-resource of the build (an image), which a sandboxed page must still load. */
  image: string;
}

/** The browser globals the in-page probes use; this package compiles without the DOM lib. */
interface PageScope {
  origin: string;
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (k: string, v: string) => void;
  };
  parent: { document: { body: unknown } };
  location: { href: string };
  document: { cookie: string };
  fetch: (url: string) => Promise<{ json: () => Promise<unknown> }>;
  Image: new () => {
    addEventListener: (type: string, listener: () => void) => void;
    src: string;
  };
}

/**
 * Runs inside the page, so it must be self-contained: Playwright sends its source text. Every probe
 * reports the error name, or `reached` when nothing stopped it.
 */
async function inPageProbe(api: string): Promise<Reach> {
  const scope = globalThis as unknown as PageScope;
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, so it cannot be imported
  const attempt = async (run: () => unknown): Promise<string> => {
    try {
      await run();
      return "reached";
    } catch (error) {
      return error instanceof Error ? error.name : String(error);
    }
  };
  return {
    origin: scope.origin,
    storage: await attempt(() => scope.localStorage.getItem("portal-secret")),
    cookie: await attempt(() => scope.document.cookie),
    parent: await attempt(() =>
      (scope.parent as unknown) === scope ? "x" : scope.parent.document.body,
    ),
    api: await attempt(async () => await (await scope.fetch(api)).json()),
    image: await new Promise<string>((resolve) => {
      const probe = new scope.Image();
      probe.addEventListener("load", () => resolve("loaded"));
      probe.addEventListener("error", () => resolve("blocked"));
      probe.src = new URL("favicon.svg", scope.location.href).href;
    }),
  };
}

/** What the page under test could reach, probed from inside `frame`. */
async function probeFrom(frame: Frame, apiUrl: string): Promise<Reach> {
  return await frame.evaluate(inPageProbe, apiUrl);
}

/** True once the story has put something in `#storybook-root`; also runs in the page. */
function inPageStoryRendered(): boolean {
  const { document } = globalThis as unknown as {
    document: { querySelector: (selector: string) => { childElementCount: number } | null };
  };
  return (document.querySelector("#storybook-root")?.childElementCount ?? 0) > 0;
}

/** Put something worth stealing in the portal's storage; runs in the portal page. */
function inPageStore(): void {
  (globalThis as unknown as PageScope).localStorage.setItem("portal-secret", "s3cr3t");
}

/** Read it back, to show the sandboxed page did not disturb it; runs in the portal page. */
function inPageRead(): string | null {
  return (globalThis as unknown as PageScope).localStorage.getItem("portal-secret");
}

/**
 * Every request the page makes that the browser blocked or that failed; none is expected. The
 * probe's own `fetch` to the API is the one request that must fail, so it is not counted.
 */
function watchFailures(page: Page): string[] {
  const failed: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/v1/health")) return;
    failed.push(`${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(`${response.url()} ${response.status()}`);
  });
  return failed;
}

async function storyRendered(frame: Frame): Promise<void> {
  await frame.waitForFunction(inPageStoryRendered, undefined, { timeout: 60_000 });
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")(
  "sandboxed Storybook hosting in a real browser",
  () => {
    let tmp = "";
    let origin = "";
    let slug = "";
    let buildId = "";
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let app: ReturnType<typeof createShelfApp> | null = null;
    let listener: ReturnType<typeof serve> | null = null;

    beforeAll(async () => {
      const staticDir = await ensureFixtureBuilt();
      const { chromium } = await import("playwright-core");
      browser = await chromium.launch();
      const port = await freePort();
      origin = `http://127.0.0.1:${port}`;
      tmp = await mkdtemp(join(tmpdir(), "storyshelf-sandbox-"));
      const dataDir = join(tmp, "data");
      await mkdir(dataDir, { recursive: true });
      const database = createSqliteDatabase(join(tmp, "shelf.db"));
      app = createShelfApp({
        database,
        storage: createLocalStorage(dataDir),
        auth: cookieAuth,
        config: {
          scratchDir: dataDir,
          secret: SECRET,
          publicBaseUrl: origin,
          storybookHosting: { mode: "sandboxed" },
        },
      });
      await app.lifecycle.setup();
      // The project's creator becomes its first member, so the session's user must exist.
      await database.insert(database.tables.users, {
        ...user,
        avatarUrl: null,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      });
      listener = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
      const created = await app.request("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Sandbox Smoke" }),
      });
      expect(created.status, await created.clone().text()).toBe(201);
      slug = (await readJson<{ slug: string }>(created)).slug;
      const uploaded = await uploadBuild(app, slug, staticDir, {
        gitSha: "a".repeat(40),
        gitBranch: "main",
        message: "sandbox smoke",
      });
      buildId = uploaded.id;
      context = await browser.newContext();
      await context.addCookies([{ ...SESSION, url: origin }]);
    }, 300_000);

    afterAll(async () => {
      await context?.close();
      await browser?.close();
      listener?.close();
      await app?.lifecycle.teardown();
      await rm(tmp, { recursive: true, force: true });
    });

    const base = (): string => `${origin}/projects/${slug}/storybook/build/${buildId}`;

    /** A portal page on the app origin that holds something worth stealing. */
    async function portalPage(): Promise<Page> {
      const page = await (context as BrowserContext).newPage();
      await page.goto(`${origin}/api/v1/health`);
      await page.evaluate(inPageStore);
      return page;
    }

    it("serves the build as private: a visitor with no session cannot open it", async () => {
      const anonymous = await (browser as Browser).newContext();
      const page = await anonymous.newPage();
      const response = await page.goto(`${base()}/iframe.html`);
      expect(response?.status()).toBe(404);
      expect(response?.url()).not.toContain("/_r/");
      await anonymous.close();
    });

    it("isolates the Storybook preview framed by an app page, and still renders the story", async () => {
      const page = await portalPage();
      const failed = watchFailures(page);
      await page.goto(`${base()}/?storyId=${STORY}`);
      const frame = await (async () => {
        const handle = await page.waitForSelector("iframe", { timeout: 30_000 });
        return (await handle.contentFrame()) as Frame;
      })();
      await storyRendered(frame);
      expect(frame.url()).toMatch(new RegExp(`^${origin}/_r/[\\w.-]+/iframe\\.html`, "u"));
      // The portal's own storage is intact, and the framed page cannot reach any of it.
      expect(await page.evaluate(inPageRead)).toBe("s3cr3t");
      expect(await probeFrom(frame, `${origin}/api/v1/health`)).toEqual({
        origin: "null",
        storage: "SecurityError",
        cookie: "SecurityError",
        parent: "SecurityError",
        api: "TypeError",
        image: "loaded",
      });
      expect(failed.filter((entry) => !entry.includes("favicon"))).toEqual([]);
      await page.close();
    }, 120_000);

    it("isolates the Storybook opened directly, manager and preview alike", async () => {
      const page = await portalPage();
      const failed = watchFailures(page);
      await page.goto(`${base()}/iframe.html?id=${STORY}&viewMode=story`);
      await storyRendered(page.mainFrame());
      expect(page.url()).toMatch(new RegExp(`^${origin}/_r/[\\w.-]+/iframe\\.html`, "u"));
      expect(await probeFrom(page.mainFrame(), `${origin}/api/v1/health`)).toMatchObject({
        origin: "null",
        storage: "SecurityError",
        cookie: "SecurityError",
        api: "TypeError",
        image: "loaded",
      });

      const manager = await (context as BrowserContext).newPage();
      const errors: string[] = [];
      manager.on("pageerror", (error) => errors.push(error.message));
      const managerFailed = watchFailures(manager);
      await manager.goto(`${base()}/index.html?path=/story/${STORY}`);
      const preview = await (async () => {
        const handle = await manager.waitForSelector("iframe[src*='iframe.html']", {
          timeout: 60_000,
        });
        return (await handle.contentFrame()) as Frame;
      })();
      await storyRendered(preview);
      expect(manager.url()).toMatch(new RegExp(`^${origin}/_r/`, "u"));
      expect((await probeFrom(manager.mainFrame(), `${origin}/api/v1/health`)).origin).toBe("null");
      expect(errors).toEqual([]);
      expect(failed.filter((entry) => !entry.includes("favicon"))).toEqual([]);
      expect(managerFailed.filter((entry) => !entry.includes("favicon"))).toEqual([]);
      await manager.close();
      await page.close();
    }, 180_000);

    it("answers every file of the build with the sandbox header and never allow-same-origin", async () => {
      const page = await (context as BrowserContext).newPage();
      const policies = new Map<string, string | undefined>();
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (url.origin === origin && url.pathname.startsWith("/_r/")) {
          policies.set(url.pathname, response.headers()["content-security-policy"]);
        }
      });
      await page.goto(`${base()}/iframe.html?id=${STORY}&viewMode=story`);
      await storyRendered(page.mainFrame());
      expect(policies.size).toBeGreaterThan(2);
      for (const policy of policies.values()) {
        expect(policy).toMatch(/^sandbox allow-scripts allow-popups allow-forms$/u);
      }
      await page.close();
    }, 120_000);
  },
);
