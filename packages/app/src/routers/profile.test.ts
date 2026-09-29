import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";

const silentLogger = pino({ level: "silent" });
const secret = "test-secret";

const accountUser = {
  id: "user_1",
  email: "ada@example.com",
  name: "Ada",
  role: "member" as const,
  providerId: "account",
};

const accountAuth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    return cookie.includes("storyshelf_session=ok") ? accountUser : null;
  },
});

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.users, {
    id: accountUser.id,
    email: accountUser.email,
    name: accountUser.name,
    avatarUrl: null,
    role: accountUser.role,
    lastLoginAt: now,
    createdAt: now,
    passwordHash: null,
    displayNameOverride: null,
    authProvider: "local",
    disabled: false,
  });
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Demo",
    slug: "demo",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(db.tables.projectMembers, {
    id: "m1",
    projectId: "p1",
    userId: accountUser.id,
    role: "viewer",
    source: "manual",
    createdAt: now,
  });
  return { db, storage };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

function testApp(seeded: Seeded): ReturnType<typeof createShelfApp> {
  return createShelfApp({
    database: seeded.db,
    storage: seeded.storage,
    auth: accountAuth,
    logger: silentLogger,
    config: { secret },
  });
}

function postForm(path: string, form: FormData, app: ReturnType<typeof createShelfApp>) {
  return app.request(path, {
    method: "POST",
    headers: { cookie: "storyshelf_session=ok", "x-csrf-token": getCsrfToken(secret, "ok") },
    body: form,
  });
}

const session = { cookie: "storyshelf_session=ok" };

describe("profile page", () => {
  it("redirects anonymous users to login", async () => {
    const response = await testApp(await seed()).request("/profile");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/login");
  });

  it("renders the user, provider, and memberships", async () => {
    const response = await testApp(await seed()).request("/profile", { headers: session });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Ada");
    expect(html).toContain("via local");
    expect(html).toContain("Demo");
  });

  it("refuses non-https avatar URLs", async () => {
    const seeded = await seed();
    const evil = { ...accountUser, avatarUrl: "javascript:alert(1)" };
    const app = createShelfApp({
      database: seeded.db,
      storage: seeded.storage,
      auth: stubAuth(null, {
        check: async (request: Request) => {
          const cookie = request.headers.get("cookie") ?? "";
          return cookie.includes("storyshelf_session=ok") ? evil : null;
        },
      }),
      logger: silentLogger,
      config: { secret },
    });
    const html = await (await app.request("/profile", { headers: session })).text();
    expect(html).not.toContain("javascript:");
    expect(html).toContain("A</span>");
  });

  it("updates the display name override", async () => {
    const seeded = await seed();
    const app = testApp(seeded);
    const form = new FormData();
    form.set("displayName", "Ada L");
    const post = await postForm("/profile", form, app);
    expect(post.status).not.toBe(400);
    const page = await app.request("/profile", { headers: session });
    expect(await page.text()).toContain("Ada L");
  });

  it("rejects an empty display name", async () => {
    const form = new FormData();
    form.set("displayName", "  ");
    const response = await postForm("/profile", form, testApp(await seed()));
    expect(response.status).toBe(400);
  });
});
