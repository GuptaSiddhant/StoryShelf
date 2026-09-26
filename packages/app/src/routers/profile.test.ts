import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { hashProfilePassword, verifyProfilePassword } from "./profile-password.ts";

const silentLogger = pino({ level: "silent" });
const secret = "test-secret";

const accountUser = {
  id: "user_1",
  email: "ada@example.com",
  name: "Ada",
  role: "member" as const,
  providerId: "account",
};

const accountAuth = {
  metadata: { name: "Stub Auth", version: "0.0.0", kind: "stub", category: "auth" as const },
  check: async (request: Request): Promise<typeof accountUser | null> => {
    await Promise.resolve();
    const cookie = request.headers.get("cookie") ?? "";
    return cookie.includes("storyshelf_session=ok") ? accountUser : null;
  },
  createSession: async (): Promise<string> => {
    await Promise.resolve();
    return "ok";
  },
  destroySession: async (): Promise<void> => {
    await Promise.resolve();
  },
};

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
    passwordHash: await hashProfilePassword("oldpassword12"),
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
    headers: { cookie: "storyshelf_session=ok", "x-csrf-token": getCsrfToken(secret) },
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

  it("changes the local account password", async () => {
    const seeded = await seed();
    const app = testApp(seeded);
    const form = new FormData();
    form.set("currentPassword", "oldpassword12");
    form.set("newPassword", "newpassword34");
    form.set("confirmPassword", "newpassword34");
    const response = await postForm("/profile/password", form, app);
    expect(response.status).toBe(200);
    const row = (await seeded.db.get(seeded.db.tables.users, accountUser.id)) as unknown as {
      passwordHash: string;
    };
    await expect(verifyProfilePassword("newpassword34", row.passwordHash)).resolves.toBe(true);
  });

  it("rejects a wrong current password", async () => {
    const form = new FormData();
    form.set("currentPassword", "wrongpassword");
    form.set("newPassword", "newpassword34");
    form.set("confirmPassword", "newpassword34");
    const response = await postForm("/profile/password", form, testApp(await seed()));
    expect(response.status).toBe(400);
  });
});
