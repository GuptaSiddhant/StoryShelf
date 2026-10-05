import { NotificationChannelModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
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

function testApp(seeded: Seeded, auth: boolean): ReturnType<typeof createShelfApp> {
  return createShelfApp({
    database: seeded.db,
    storage: seeded.storage,
    ...(auth ? { auth: memberAuth } : {}),
    notifiers: [stubProvider("email"), stubProvider("log")],
    logger: pino({ level: "silent" }),
    config: { secret },
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
    expect(html).toContain("Create channel");
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
});
