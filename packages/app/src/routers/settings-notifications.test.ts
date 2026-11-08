import { NotificationChannelModel, NotificationSubscriptionModel } from "@storyshelf/core/models";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { LISTED_TOPICS } from "../pages/settings-notifications.tsx";
import { stubAuth } from "../stub-auth.ts";

const secret = "test-secret";
const member = { id: "user_1", email: "m@example.com", name: "M", role: "member" as const };

const memberAuth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    return cookie.includes("storyshelf_session=ok") ? member : null;
  },
});

const repoSchema = z.object({ owner: z.string().min(1), repo: z.string().min(1) });

function stubProvider(kind: string) {
  const metadata = {
    name: kind,
    version: "0.0.0",
    kind,
    category: "notifier" as const,
    schema: z.object({}).loose(),
  };
  return {
    metadata,
    create: () => ({ metadata, send: async () => {} }),
  };
}

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Notify Project",
    slug: "notify-project",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(db.tables.users, {
    id: member.id,
    email: member.email,
    name: member.name,
    avatarUrl: null,
    role: member.role,
    lastLoginAt: null,
    createdAt: now,
    passwordHash: null,
    displayNameOverride: null,
    authProvider: "local",
    disabled: false,
  });
  await db.insert(db.tables.projectMembers, {
    id: "m1",
    projectId: "p1",
    userId: member.id,
    role: "developer",
    source: "manual",
    createdAt: now,
  });
  return { db, storage };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

function testApp(
  seeded: Seeded,
  auth: boolean,
  publicBaseUrl?: string,
): ReturnType<typeof createShelfApp> {
  return createShelfApp({
    database: seeded.db,
    storage: seeded.storage,
    ...(auth ? { auth: memberAuth } : {}),
    notifications: {
      notifiers: [
        stubProvider("email"),
        stubProvider("log"),
        makeFakeStateNotifier("github", undefined, repoSchema).provider,
      ],
    },
    logger: pino({ level: "silent" }),
    config: { secret, ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }) },
  });
}

function postForm(
  path: string,
  body: Record<string, string> | URLSearchParams,
  app: ReturnType<typeof createShelfApp>,
) {
  return app.request(path, {
    method: "POST",
    headers: {
      cookie: "storyshelf_session=ok",
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken(secret, "ok"),
    },
    body: new URLSearchParams(body).toString(),
  });
}

describe("notifications settings tab", () => {
  it("renders channels, providers, and my preferences", async () => {
    const app = testApp(await seed(), false);
    const page = await app.request("/projects/notify-project/settings/notifications");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("My notifications for this project");
    expect(html).toContain("Add a message channel");
    expect(html).toContain("Add a git channel");
    expect(html).toContain("Build failed");
    expect(html).not.toContain("settings/status");
  });

  it("says notifications are paused until a public URL is set, and only then", async () => {
    const paused = "Notifications are paused until a public URL is set";
    const without = testApp(await seed(), false);
    expect(
      await (await without.request("/projects/notify-project/settings/notifications")).text(),
    ).toContain(paused);
    const withOrigin = testApp(await seed(), false, "https://shelf.example.com");
    expect(
      await (await withOrigin.request("/projects/notify-project/settings/notifications")).text(),
    ).not.toContain(paused);
  });

  it("creates an email channel from the form", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    const saved = await postForm(
      "/projects/notify-project/settings/notifications",
      { provider: "email", target: "team@example.com", events: "build.created", style: "compact" },
      app,
    );
    expect(saved.status).toBe(201);
    const rows = await new NotificationChannelModel(seeded.db, undefined, secret).list("p1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("email");
    expect(rows[0]?.secretEncrypted).toBeNull();
  });

  it("stores webhook URLs as secrets and rejects unknown providers", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    const saved = await postForm(
      "/projects/notify-project/settings/notifications",
      { provider: "log", target: "https://hooks.example.com/x" },
      app,
    );
    expect(saved.status).toBe(201);
    const bad = await postForm(
      "/projects/notify-project/settings/notifications",
      { provider: "pigeon", target: "x" },
      app,
    );
    expect(bad.status).toBe(400);
  });

  it("deletes a channel from the form", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    await postForm(
      "/projects/notify-project/settings/notifications",
      { provider: "email", target: "team@example.com" },
      app,
    );
    const rows = await new NotificationChannelModel(seeded.db, undefined, secret).list("p1");
    const deleted = await postForm(
      `/projects/notify-project/settings/notifications/${rows[0]?.id}/delete`,
      {},
      app,
    );
    expect(deleted.status).not.toBe(404);
    expect(
      await new NotificationChannelModel(seeded.db, undefined, secret).list("p1"),
    ).toHaveLength(0);
  });

  it("saves my preferences and requires sign-in", async () => {
    const seeded = await seed();
    const openApp = testApp(seeded, false);
    const anon = await postForm(
      "/projects/notify-project/settings/notifications/me",
      { enabled: "on" },
      openApp,
    );
    expect(anon.status).toBe(401);

    const app = testApp(seeded, true);
    const saved = await postForm(
      "/projects/notify-project/settings/notifications/me",
      { enabled: "on", events: "build:approved" },
      app,
    );
    expect(saved.status).not.toBe(401);
    const page = await app.request("/projects/notify-project/settings/notifications", {
      headers: { cookie: "storyshelf_session=ok" },
    });
    expect(await page.text()).toContain('value="build:approved" checked');
  });

  it("stores all topics as null when every box or none is ticked, and a list otherwise", async () => {
    const seeded = await seed();
    const app = testApp(seeded, true);
    const path = "/projects/notify-project/settings/notifications/me";
    const subscriptions = new NotificationSubscriptionModel(seeded.db);
    const all = new URLSearchParams();
    all.set("enabled", "on");
    for (const entry of LISTED_TOPICS) {
      all.append("events", entry.event);
    }
    await postForm(path, all, app);
    expect((await subscriptions.getFor("p1", member.id))?.events).toBeNull();

    // A partial list also carries review:requested, which only the review switch controls.
    await postForm(path, { enabled: "on", events: "build:approved" }, app);
    expect((await subscriptions.getFor("p1", member.id))?.events).toBe(
      '["build:approved","review:requested"]',
    );

    await postForm(path, { enabled: "on" }, app);
    expect((await subscriptions.getFor("p1", member.id))?.events).toBeNull();
  });

  it("keeps the subscription when email is switched off, and keeps its topics for later", async () => {
    const seeded = await seed();
    const app = testApp(seeded, true);
    const path = "/projects/notify-project/settings/notifications/me";
    const subscriptions = new NotificationSubscriptionModel(seeded.db);
    await postForm(path, { enabled: "on", events: "build:approved", reviewRequests: "on" }, app);

    await postForm(path, { reviewRequests: "on" }, app);
    const off = await subscriptions.getFor("p1", member.id);
    expect(off).toMatchObject({
      enabled: false,
      events: '["build:approved","review:requested"]',
      reviewRequests: true,
    });

    await postForm(path, { enabled: "on", events: "build:approved", reviewRequests: "on" }, app);
    expect(await subscriptions.getFor("p1", member.id)).toMatchObject({ enabled: true });
  });

  it("flips only the review-request switch, and records it for someone with no subscription", async () => {
    const seeded = await seed();
    const app = testApp(seeded, true);
    const path = "/projects/notify-project/settings/notifications/me";
    const subscriptions = new NotificationSubscriptionModel(seeded.db);
    await postForm(path, {}, app);
    expect(await subscriptions.getFor("p1", member.id)).toMatchObject({
      enabled: false,
      reviewRequests: false,
      events: null,
      via: null,
    });

    await postForm(path, { enabled: "on", events: "build:approved", reviewRequests: "on" }, app);
    await postForm(path, { enabled: "on", events: "build:approved" }, app);
    expect(await subscriptions.getFor("p1", member.id)).toMatchObject({
      enabled: true,
      events: '["build:approved","review:requested"]',
      via: '["email"]',
      reviewRequests: false,
    });
  });

  it("lets the switch take effect for an older topic list that left review requests out", async () => {
    const seeded = await seed();
    const app = testApp(seeded, true);
    const path = "/projects/notify-project/settings/notifications";
    const subscriptions = new NotificationSubscriptionModel(seeded.db);
    await subscriptions.upsert("p1", member.id, {
      events: ["build:approved"],
      via: ["email"],
      enabled: false,
      reviewRequests: false,
    });
    await postForm(`${path}/me`, { reviewRequests: "on" }, app);
    const row = await subscriptions.getFor("p1", member.id);
    expect(NotificationSubscriptionModel.eventsOf(row!)).toEqual([
      "build:approved",
      "review:requested",
    ]);
    expect(row).toMatchObject({ enabled: false, reviewRequests: true });
    const html = await (
      await app.request(path, { headers: { cookie: "storyshelf_session=ok" } })
    ).text();
    expect(html).toMatch(/name="reviewRequests"[^>]*checked/u);
  });

  it("keeps channels chosen elsewhere when the form saves, and adds email to a switched-off row", async () => {
    const seeded = await seed();
    const app = testApp(seeded, true);
    const path = "/projects/notify-project/settings/notifications/me";
    const subscriptions = new NotificationSubscriptionModel(seeded.db);
    await subscriptions.upsert("p1", member.id, { via: ["email", "dm"] });
    await postForm(path, { enabled: "on", reviewRequests: "on" }, app);
    expect(
      NotificationSubscriptionModel.viaOf((await subscriptions.getFor("p1", member.id))!),
    ).toEqual(["email", "dm"]);
    await subscriptions.upsert("p1", member.id, { via: ["dm"], enabled: false });
    await postForm(path, { enabled: "on", reviewRequests: "on" }, app);
    expect(
      NotificationSubscriptionModel.viaOf((await subscriptions.getFor("p1", member.id))!),
    ).toEqual(["dm", "email"]);
  });

  it("lists every subscribable topic, review ones included, and the review switch", async () => {
    const seeded = await seed();
    const app = testApp(seeded, true);
    const page = await app.request("/projects/notify-project/settings/notifications", {
      headers: { cookie: "storyshelf_session=ok" },
    });
    const html = await page.text();
    for (const entry of LISTED_TOPICS) {
      expect(html).toContain(`value="${entry.event}"`);
    }
    expect(html).toContain('value="review:verdict"');
    // One control per event: the review switch owns review:requested, which has no checkbox.
    expect(html).not.toContain('value="review:requested"');
    expect(html).toContain("Send me review requests");
    expect(html).toContain("review requests by email by default");
    expect(html).not.toContain("Leave everything off to stay silent");
  });

  it("explains the switch when email is off, and shows it off for a list that leaves it out", async () => {
    const seeded = await seed();
    const app = testApp(seeded, true);
    const path = "/projects/notify-project/settings/notifications";
    const page = async () =>
      await (await app.request(path, { headers: { cookie: "storyshelf_session=ok" } })).text();
    expect(await page()).toContain("Emails you when a build waits for a verdict");

    const subscriptions = new NotificationSubscriptionModel(seeded.db);
    await subscriptions.upsert("p1", member.id, { via: ["email"], enabled: false });
    expect(await page()).toContain("Email me is off, so no review requests reach you");

    await subscriptions.upsert("p1", member.id, { via: ["email"], events: ["build:approved"] });
    expect(await page()).toMatch(/name="reviewRequests"(?![^>]*checked)/u);
  });

  it("creates a git channel with the token as its secret and no event filter", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    const saved = await postForm(
      "/projects/notify-project/settings/notifications",
      {
        gitProvider: "github",
        owner: "acme",
        repo: "widgets",
        prefix: "storyshelf-web",
        host: "",
        token: "ghp_secret",
      },
      app,
    );
    expect(saved.status).toBe(201);
    const model = new NotificationChannelModel(seeded.db, undefined, secret);
    const [row] = await model.list("p1");
    expect(row?.provider).toBe("github");
    expect(NotificationChannelModel.configOf(row!)).toEqual({
      owner: "acme",
      repo: "widgets",
      prefix: "storyshelf-web",
    });
    expect(row?.events).toBeNull();
    expect(row?.secretEncrypted).not.toContain("ghp_secret");
    expect(model.decryptSecret(row!)).toBe("ghp_secret");
    const page = await app.request("/projects/notify-project/settings/notifications");
    const html = await page.text();
    expect(html).toContain("acme/widgets (storyshelf-web)");
    expect(html).toContain("build state");
  });

  it("stores a GitHub App channel's private key as its encrypted secret, never echoed", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    const key = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
    const saved = await postForm(
      "/projects/notify-project/settings/notifications",
      {
        gitProvider: "github",
        owner: "acme",
        repo: "widgets",
        mode: "checks",
        appId: "12",
        installationId: "34",
        token: "",
        privateKey: key,
      },
      app,
    );
    expect(saved.status).toBe(201);
    const model = new NotificationChannelModel(seeded.db, undefined, secret);
    const [row] = await model.list("p1");
    expect(NotificationChannelModel.configOf(row!)).toEqual({
      owner: "acme",
      repo: "widgets",
      mode: "checks",
      appId: "12",
      installationId: "34",
    });
    expect(row?.secretEncrypted).not.toContain("PRIVATE KEY");
    expect(model.decryptSecret(row!)).toBe(key);
    const page = await (
      await app.request("/projects/notify-project/settings/notifications")
    ).text();
    expect(page).not.toContain("BEGIN PRIVATE KEY");
  });

  it("asks for the private key, not a token, when a checks channel has none", async () => {
    const app = testApp(await seed(), false);
    const missing = await postForm(
      "/projects/notify-project/settings/notifications",
      { gitProvider: "github", owner: "a", repo: "b", mode: "checks", token: "ghp_ignored" },
      app,
    );
    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain("A git channel needs a token or private key");
  });

  it("shows a failing git channel's last error on the page", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    await postForm(
      "/projects/notify-project/settings/notifications",
      { gitProvider: "github", owner: "acme", repo: "widgets", token: "t" },
      app,
    );
    const model = new NotificationChannelModel(seeded.db, undefined, secret);
    const [row] = await model.list("p1");
    await model.recordOutcome(row!.id, "HTTP 401: Bad credentials");
    const html = await (
      await app.request("/projects/notify-project/settings/notifications")
    ).text();
    expect(html).toContain("failing");
    expect(html).toContain("HTTP 401: Bad credentials");
    // The failure time and the error are separate lines, so the time never wraps mid-phrase, and
    // the error truncates with its whole text on hover.
    expect(html).toMatch(/<span class="truncate max-w-cell"><span[^>]*>Failed /u);
    expect(html).toContain('<span class="truncate max-w-cell" title="HTTP 401: Bad credentials">');
  });

  it("reports git form problems on the fields they concern", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    const path = "/projects/notify-project/settings/notifications";
    const noOwner = await postForm(
      path,
      { gitProvider: "github", repo: "widgets", token: "t" },
      app,
    );
    expect(noOwner.status).toBe(400);
    const noToken = await postForm(path, { gitProvider: "github", owner: "a", repo: "b" }, app);
    expect(noToken.status).toBe(400);
    expect(await noToken.text()).toContain("A git channel needs a token");
    const unknown = await postForm(
      path,
      { gitProvider: "email", owner: "a", repo: "b", token: "t" },
      app,
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toContain("Unknown git provider: email");
    expect(
      await new NotificationChannelModel(seeded.db, undefined, secret).list("p1"),
    ).toHaveLength(0);
  });

  it("does not let the message form create a git channel", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    const bad = await postForm(
      "/projects/notify-project/settings/notifications",
      { provider: "github", target: "ghp_token" },
      app,
    );
    expect(bad.status).toBe(400);
  });
});
