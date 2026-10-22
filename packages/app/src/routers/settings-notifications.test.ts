import { NotificationChannelModel } from "@storyshelf/core/models";
import { makeDatabase, makeFakeStateNotifier, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
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
  body: Record<string, string>,
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
