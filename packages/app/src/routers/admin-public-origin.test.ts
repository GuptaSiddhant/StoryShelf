import { createShelfLogger } from "@storyshelf/core/logger";
import {
  NotificationChannelModel,
  PUBLIC_ORIGIN_KEY,
  SiteSettingsModel,
} from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeFakeStateNotifier,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOpenBuildStatesNow } from "../git-status.ts";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

// The replay entrypoint is spied on (it still runs), so a test can ask whether it was called
// without waiting for what it would do.
vi.mock("../git-status.ts", async (original) => {
  const real = await original<typeof import("../git-status.ts")>();
  return { ...real, requestOpenBuildStatesNow: vi.fn(real.requestOpenBuildStatesNow) };
});

const silent = createShelfLogger({ level: "silent" });

// A spy made with `vi.spyOn` must not outlive its test, whether or not the test got to the end.
afterEach(() => {
  vi.restoreAllMocks();
});
const ORIGIN = "https://shelf.example.com";

async function seedApp(options: {
  db?: ReturnType<typeof makeDatabase>["db"];
  config?: Record<string, unknown>;
  role?: "admin" | "member" | null;
  notifiers?: NonNullable<Parameters<typeof createShelfApp>[0]["notifications"]>["notifiers"];
}) {
  const db = options.db ?? makeDatabase().db;
  const { storage } = makeStorage();
  const role = options.role === undefined ? "admin" : options.role;
  const app = createShelfApp({
    database: db,
    storage,
    logger: silent,
    config: { secret: "origin-test-secret", ...options.config },
    ...(options.notifiers === undefined ? {} : { notifications: { notifiers: options.notifiers } }),
    ...(role ? { auth: stubAuth({ id: "u1", email: "a@b.c", name: "A", role }) } : {}),
  });
  await app.lifecycle.setup();
  return app;
}

async function csrfFrom(app: Awaited<ReturnType<typeof seedApp>>): Promise<string> {
  const html = await (await app.request("/admin")).text();
  return /name="csrf-token" content="([^"]+)"/u.exec(html)?.[1] ?? "";
}

/** The toast queued by the response's flash cookie, if any. */
function flashOf(response: Response): { message: string; tone: string } | undefined {
  const raw = /storyshelf_flash=(?<payload>[^;]+)/u.exec(response.headers.get("set-cookie") ?? "")
    ?.groups?.["payload"];
  return raw
    ? (JSON.parse(decodeURIComponent(raw)) as { message: string; tone: string })
    : undefined;
}

function report(
  app: Awaited<ReturnType<typeof seedApp>>,
  token: string,
  body: unknown,
  origin = ORIGIN,
) {
  return app.request("/admin/public-origin/report", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": token, origin },
    body: JSON.stringify(body),
  });
}

function form(
  app: Awaited<ReturnType<typeof seedApp>>,
  path: string,
  token: string,
  origin?: string,
) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrf_token: token,
      ...(origin === undefined ? {} : { origin }),
    }).toString(),
  });
}

describe("public origin on the System page", () => {
  it("warns that nothing is known and asks the page to report its origin", async () => {
    const app = await seedApp({});
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("No public origin is known");
    expect(html).toContain('data-report-origin="/admin/public-origin/report"');
  });

  it("learns the origin from the first report and shows it as detected, unconfirmed", async () => {
    const app = await seedApp({});
    const token = await csrfFrom(app);
    expect((await report(app, token, { origin: ORIGIN })).status).toBe(201);
    expect(
      (
        await report(
          app,
          token,
          { origin: "https://other.example.com" },
          "https://other.example.com",
        )
      ).status,
    ).toBe(200);
    const html = await (await app.request("/admin")).text();
    expect(html).toContain(ORIGIN);
    expect(html).toContain("Public origin detected, not confirmed");
    expect(html).toContain("Confirm it to enable");
    expect(html).not.toContain("other.example.com");
  });

  it("rejects a report that disagrees with the Origin header, or is not an origin", async () => {
    const app = await seedApp({});
    const token = await csrfFrom(app);
    expect((await report(app, token, { origin: ORIGIN }, "https://evil.example.com")).status).toBe(
      400,
    );
    expect(
      (await report(app, token, { origin: "javascript:alert(1)" }, "javascript:alert(1)")).status,
    ).toBe(400);
    expect((await report(app, token, {})).status).toBe(400);
  });

  it("tells the admin why a typed origin is refused, but never a storage failure's text", async () => {
    const app = await seedApp({});
    const token = await csrfFrom(app);

    const refused = await form(
      app,
      "/admin/public-origin",
      token,
      "https://shelf.example.com/path",
    );
    expect(flashOf(refused)?.message).toContain("must be an http(s) origin");

    vi.spyOn(SiteSettingsModel.prototype, "set").mockRejectedValue(
      new Error("SQLITE_BUSY: database is locked (/var/data/shelf.db)"),
    );
    const logged = vi.spyOn(silent, "error");
    const failed = await form(app, "/admin/public-origin", token, ORIGIN);
    const message = flashOf(failed)?.message ?? "";
    expect(message).toBe("Invalid origin");
    expect(message).not.toContain("SQLITE");
    expect(logged).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: expect.stringContaining("SQLITE_BUSY") }) },
      "unexpected error answered with a generic message",
    );
  });

  it("stops asking once the configuration or the platform answers", async () => {
    const app = await seedApp({ config: { publicBaseUrl: "https://configured.example.com" } });
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("configured.example.com");
    expect(html).toContain("configured (PUBLIC_BASE_URL)");
    expect(html).not.toContain("data-report-origin");
    // Nothing to confirm: no stored-origin form and no entry form either (#315).
    expect(html).not.toContain('action="/admin/public-origin"');
    expect(html).toContain("Nothing to confirm.");
  });

  it.each([
    ["configuration", "https://configured.example.com", {}],
    ["platform", "https://platform.example.com", { RAILWAY_PUBLIC_DOMAIN: "platform.example.com" }],
  ])(
    "learns and stores nothing when the %s answers, and refuses a typed origin",
    async (_source, fixed, env) => {
      for (const [name, value] of Object.entries(env)) {
        vi.stubEnv(name, value);
      }
      try {
        const { db } = makeDatabase();
        const app = await seedApp({
          db,
          config: Object.keys(env).length === 0 ? { publicBaseUrl: fixed } : {},
        });
        const token = await csrfFrom(app);
        expect((await report(app, token, { origin: ORIGIN })).status).toBe(204);
        expect(await new SiteSettingsModel(db).get(PUBLIC_ORIGIN_KEY)).toBeNull();
        const response = await form(app, "/admin/public-origin", token, "https://shelf.acme.io");
        expect(response.status).toBeLessThan(400);
        expect(flashOf(response)).toEqual({
          message: expect.stringContaining("PUBLIC_BASE_URL") as string,
          tone: "warning",
        });
        expect(await new SiteSettingsModel(db).get(PUBLIC_ORIGIN_KEY)).toBeNull();
        const html = await (await app.request("/admin")).text();
        expect(html).toContain(new URL(fixed).host);
        expect(html).not.toContain("shelf.acme.io");
        expect(html).not.toContain(ORIGIN);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("lets an admin confirm, replace and forget the stored origin", async () => {
    const app = await seedApp({});
    const token = await csrfFrom(app);
    await report(app, token, { origin: ORIGIN });
    expect(
      (await form(app, "/admin/public-origin", token, "https://shelf.acme.io")).status,
    ).toBeLessThan(400);
    let html = await (await app.request("/admin")).text();
    expect(html).toContain("https://shelf.acme.io");
    expect(html).toContain("confirmed by an admin");
    expect(html).not.toContain("not confirmed");
    await form(app, "/admin/public-origin/clear", token);
    html = await (await app.request("/admin")).text();
    expect(html).toContain("No public origin is known");
  });

  it("refuses an origin with a path or another scheme", async () => {
    const app = await seedApp({});
    const token = await csrfFrom(app);
    await form(app, "/admin/public-origin", token, "https://shelf.acme.io/path");
    await form(app, "/admin/public-origin", token, "ftp://shelf.acme.io");
    expect(await (await app.request("/admin")).text()).toContain("No public origin is known");
  });

  it("needs a CSRF token and a site admin", async () => {
    const app = await seedApp({});
    const noToken = await app.request("/admin/public-origin/report", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ origin: ORIGIN }),
    });
    expect(noToken.status).toBe(403);
    const member = await seedApp({ role: "member" });
    expect([401, 403]).toContain((await form(member, "/admin/public-origin", "x", ORIGIN)).status);
  });

  it("learns nothing without authentication", async () => {
    const app = await seedApp({ role: null });
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("turn authentication on");
    expect(html).not.toContain("data-report-origin");
    const token = await csrfFrom(app);
    expect((await report(app, token, { origin: ORIGIN })).status).toBe(204);
  });
});

/** An admin app with a git channel and one open build; resolves to what the tests drive. */
async function openBuildApp(logger: typeof silent = silent) {
  const git = makeFakeStateNotifier();
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    logger,
    config: { secret: "origin-test-secret" },
    auth: stubAuth({ id: "u1", email: "a@b.c", name: "A", role: "admin" }),
    notifications: { notifiers: [git.provider] },
  });
  await app.lifecycle.setup();
  const project = await createTestProject(db, db.tables);
  const build = await createTestBuild(db, db.tables, project.id);
  await new NotificationChannelModel(db, undefined, "origin-test-secret").create({
    projectId: project.id,
    provider: "fake-git",
    config: {},
    secret: "token",
  });
  const token = await csrfFrom(app);
  const urlOf = (origin: string) => `${origin}/projects/${project.slug}/builds/${build.id}`;
  return { app, git, token, urlOf };
}

/** A project channel, enabled or not: the banner is about enabled channels only (#1018). */
async function addChannel(
  db: ReturnType<typeof makeDatabase>["db"],
  enabled: boolean,
): Promise<void> {
  const project = await createTestProject(db, db.tables);
  await new NotificationChannelModel(db, undefined, "origin-test-secret").create({
    projectId: project.id,
    provider: "fake-git",
    config: {},
    secret: "token",
    enabled,
  });
}

describe("notifications without a public origin", () => {
  const paused = "Notifications are paused until a public URL is set";

  it("warns on the System page while a channel is enabled and no origin resolves", async () => {
    const git = makeFakeStateNotifier();
    const { db } = makeDatabase();
    const app = await seedApp({ db, notifiers: [git.provider] });
    await addChannel(db, true);
    expect(await (await app.request("/admin")).text()).toContain(paused);
  });

  it("stays quiet with notifiers wired but no channel configured (#1018)", async () => {
    const git = makeFakeStateNotifier();
    const app = await seedApp({ notifiers: [git.provider] });
    expect(await (await app.request("/admin")).text()).not.toContain(paused);
  });

  it("stays quiet when every channel is disabled (#1018)", async () => {
    const git = makeFakeStateNotifier();
    const { db } = makeDatabase();
    const app = await seedApp({ db, notifiers: [git.provider] });
    await addChannel(db, false);
    expect(await (await app.request("/admin")).text()).not.toContain(paused);
  });

  it("stays quiet with an origin, or with no notifier wired", async () => {
    const git = makeFakeStateNotifier();
    const withOrigin = await seedApp({
      notifiers: [git.provider],
      config: { publicBaseUrl: ORIGIN },
    });
    expect(await (await withOrigin.request("/admin")).text()).not.toContain(paused);
    // No channel configured: quiet even with the built-in notifiers wired (#1018).
    const noChannel = await seedApp({});
    expect(await (await noChannel.request("/admin")).text()).not.toContain(paused);
  });

  it("asks again for the state of open builds once an admin confirms an origin", async () => {
    const { app, git, token, urlOf } = await openBuildApp();
    await form(app, "/admin/public-origin", token, ORIGIN);
    await vi.waitFor(() => {
      expect(git.calls.length).toBeGreaterThan(0);
    });
    expect(git.calls[0]?.url).toBe(urlOf(ORIGIN));
  });

  it("asks again when an admin replaces the confirmed origin, so posted links follow it", async () => {
    const { app, git, token, urlOf } = await openBuildApp();
    await form(app, "/admin/public-origin", token, ORIGIN);
    await vi.waitFor(() => {
      expect(git.calls.length).toBeGreaterThan(0);
    });
    git.calls.length = 0;
    const replacement = "https://shelf.acme.io";
    await form(app, "/admin/public-origin", token, replacement);
    await vi.waitFor(() => {
      expect(git.calls.length).toBeGreaterThan(0);
    });
    expect(git.calls.every((call) => call.url === urlOf(replacement))).toBe(true);
  });

  it("asks nothing when the same origin is saved again", async () => {
    const { app, git, token } = await openBuildApp();
    await form(app, "/admin/public-origin", token, ORIGIN);
    await vi.waitFor(() => {
      expect(git.calls.length).toBeGreaterThan(0);
    });
    vi.mocked(requestOpenBuildStatesNow).mockClear();
    await form(app, "/admin/public-origin", token, ORIGIN);
    expect(requestOpenBuildStatesNow).not.toHaveBeenCalled();
  });

  it("asks once for a replacement, and not for a report", async () => {
    const { app, token } = await openBuildApp();
    await form(app, "/admin/public-origin", token, ORIGIN);
    vi.mocked(requestOpenBuildStatesNow).mockClear();
    await report(app, token, { origin: ORIGIN });
    expect(requestOpenBuildStatesNow).not.toHaveBeenCalled();
    await form(app, "/admin/public-origin", token, "https://shelf.acme.io");
    expect(requestOpenBuildStatesNow).toHaveBeenCalledTimes(1);
  });

  it("logs a change once, naming the new origin and whether it replaced one", async () => {
    const lines: { msg: string; origin: string; replaced: boolean }[] = [];
    const logger = pino(
      { level: "info" },
      { write: (line: string) => lines.push(JSON.parse(line) as (typeof lines)[number]) },
    );
    const { app, git, token } = await openBuildApp(logger as never);
    await form(app, "/admin/public-origin", token, ORIGIN);
    await form(app, "/admin/public-origin", token, "https://shelf.acme.io");
    await form(app, "/admin/public-origin", token, "https://shelf.acme.io");
    await vi.waitFor(() => {
      expect(git.calls.length).toBeGreaterThan(1);
    });
    const changes = lines.filter((line) => line.msg.startsWith("public origin changed"));
    expect(changes.map((line) => [line.origin, line.replaced])).toEqual([
      [ORIGIN, false],
      ["https://shelf.acme.io", true],
    ]);
  });

  it("stays paused after a report: a detected origin counts only once confirmed", async () => {
    const git = makeFakeStateNotifier();
    const { db } = makeDatabase();
    const app = await seedApp({ db, notifiers: [git.provider] });
    await addChannel(db, true);
    const token = await csrfFrom(app);
    expect((await report(app, token, { origin: ORIGIN })).status).toBe(201);
    expect(await (await app.request("/admin")).text()).toContain(paused);
    expect(git.calls).toHaveLength(0);
    await form(app, "/admin/public-origin", token, ORIGIN);
    expect(await (await app.request("/admin")).text()).not.toContain(paused);
  });
});
