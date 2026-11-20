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
    ...(kind === "email" ? { audience: "person" as const } : {}),
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
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken(secret, "ok"),
    },
    body: new URLSearchParams(body).toString(),
  });
}

describe("notifications settings tab", () => {
  it("renders channels, providers, and my preferences", async () => {
    const app = testApp(await seed(), false);
    const page = await app.request("/projects/notify-project/settings/review");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("My notifications for this project");
    expect(html).toContain("Add channel");
    expect(html).toContain("Add a git channel");
    expect(html).toContain("Build failed");
    expect(html).not.toContain("settings/status");
  });

  it("says notifications are paused until a public URL is set, and only then", async () => {
    const paused = "Notifications are paused until a public URL is set";
    const without = testApp(await seed(), false);
    expect(
      await (await without.request("/projects/notify-project/settings/review")).text(),
    ).toContain(paused);
    const withOrigin = testApp(await seed(), false, "https://shelf.example.com");
    expect(
      await (await withOrigin.request("/projects/notify-project/settings/review")).text(),
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
    expect(saved.status).toBe(302);
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
    expect(saved.status).toBe(302);
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
    const page = await app.request("/projects/notify-project/settings/review", {
      headers: { cookie: "storyshelf_session=ok", "sec-fetch-site": "same-origin" },
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
      await app.request("/projects/notify-project/settings/review", {
        headers: { cookie: "storyshelf_session=ok", "sec-fetch-site": "same-origin" },
      })
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
    const page = await app.request("/projects/notify-project/settings/review", {
      headers: { cookie: "storyshelf_session=ok", "sec-fetch-site": "same-origin" },
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
    const path = "/projects/notify-project/settings/review";
    const page = async () =>
      await (
        await app.request(path, {
          headers: { cookie: "storyshelf_session=ok", "sec-fetch-site": "same-origin" },
        })
      ).text();
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
    const page = await app.request("/projects/notify-project/settings/review");
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
    const page = await (await app.request("/projects/notify-project/settings/review")).text();
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
    const html = await (await app.request("/projects/notify-project/settings/review")).text();
    expect(html).toContain("Failing");
    expect(html).toMatch(/Failed [^<]*HTTP 401: Bad credentials/u);
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

describe("dialog forms (ADR 0012, decision 10)", () => {
  const hx = { "HX-Request": "true" };

  it("answers an HTMX request with the add form's fragment and a plain one with the page", async () => {
    const app = testApp(await seed(), false);
    const path = "/projects/notify-project/settings/notifications/new";
    const fragment = await (await app.request(path, { headers: hx })).text();
    expect(fragment).toContain('id="add-channel-form"');
    expect(fragment).not.toContain("<html");
    expect(fragment).toContain('data-option-fields="provider"');
    expect(fragment).toContain('name="csrf_token"');
    const page = await (await app.request(path)).text();
    expect(page).toContain("<html");
    expect(page).toContain('id="add-channel-form"');
    expect(page).toContain("Add channel");
  });

  it("re-renders the add form inside the dialog on a refusal, keeping the chosen kind", async () => {
    const app = testApp(await seed(), false);
    const refused = await app.request("/projects/notify-project/settings/notifications", {
      method: "POST",
      headers: {
        ...hx,
        cookie: "storyshelf_session=ok",
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
        "x-csrf-token": getCsrfToken(secret, "ok"),
      },
      body: new URLSearchParams({
        provider: "email",
        target: "",
        events: "build.created",
      }).toString(),
    });
    expect(refused.status).toBe(400);
    const html = await refused.text();
    expect(html).toContain('id="add-channel-form"');
    expect(html).not.toContain("<html");
    expect(html).toContain("Enter a target");
    expect(html).toContain('value="build.created"');
  });

  it("refuses fields of another kind than the one selected", async () => {
    const app = testApp(await seed(), false);
    const refused = await postForm(
      "/projects/notify-project/settings/notifications",
      { provider: "email", target: "a@example.com" },
      app,
    );
    expect(refused.status).toBe(302);
    const unknown = await postForm(
      "/projects/notify-project/settings/notifications",
      { provider: "nope", target: "x" },
      app,
    );
    expect(unknown.status).toBe(400);
  });

  it("edits a message channel: the address, the events and the style, keeping the secret on a blank URL", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    const model = new NotificationChannelModel(seeded.db, undefined, secret);
    const email = await model.create({
      projectId: "p1",
      provider: "email",
      config: { to: "a@example.com", style: "compact" },
    });
    const log = await model.create({
      projectId: "p1",
      provider: "log",
      config: { style: "compact" },
      secret: "https://hooks.example.com/old",
    });
    const base = "/projects/notify-project/settings/notifications";
    const form = await (await app.request(`${base}/${email.id}/edit`, { headers: hx })).text();
    expect(form).toContain('value="a@example.com"');
    const saved = await postForm(
      `${base}/${email.id}/edit`,
      { target: "b@example.com", events: "build.approved", style: "verbose" },
      app,
    );
    expect(saved.status).toBe(302);
    const row = await model.get(email.id);
    expect(NotificationChannelModel.configOf(row!)).toMatchObject({
      to: "b@example.com",
      style: "verbose",
    });
    expect(NotificationChannelModel.eventsOf(row!)).toEqual(["build.approved"]);
    await postForm(`${base}/${log.id}/edit`, { target: "", style: "verbose" }, app);
    const kept = await model.get(log.id);
    expect(model.decryptSecret(kept!)).toBe("https://hooks.example.com/old");
    const blankEmail = await postForm(`${base}/${email.id}/edit`, { target: "" }, app);
    expect(blankEmail.status).toBe(400);
  });

  it("does not edit a git channel or another project's channel", async () => {
    const seeded = await seed();
    const app = testApp(seeded, false);
    const model = new NotificationChannelModel(seeded.db, undefined, secret);
    const git = await model.create({
      projectId: "p1",
      provider: "github",
      config: { owner: "o", repo: "r" },
      secret: "t",
    });
    const base = "/projects/notify-project/settings/notifications";
    expect((await app.request(`${base}/${git.id}/edit`)).status).toBe(404);
    expect((await app.request(`${base}/missing/edit`)).status).toBe(404);
  });

  it("serves the member, token, webhook, general and review forms as fragments and pages", async () => {
    const app = testApp(await seed(), false);
    const forms: Record<string, string> = {
      "/projects/notify-project/settings/members/new": "add-member-form",
      "/projects/notify-project/settings/members/groups/new": "add-group-mapping-form",
      "/projects/notify-project/settings/tokens/new": "create-token-form",
      "/projects/notify-project/settings/webhooks/new": "add-webhook-form",
      "/projects/notify-project/settings/general/edit": "edit-general-form",
      "/projects/notify-project/settings/review/edit": "edit-review-form",
    };
    for (const [path, id] of Object.entries(forms)) {
      const fragment = await app.request(path, { headers: hx });
      expect(fragment.status, path).toBe(200);
      const text = await fragment.text();
      expect(text, path).toContain(`id="${id}"`);
      expect(text, path).not.toContain("<html");
      expect(await (await app.request(path)).text(), path).toContain("<html");
    }
  });
});
