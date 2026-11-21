import { createShelfLogger } from "@storyshelf/core/logger";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { READ_ONLY_BANNER_TITLE } from "./read-only-banner.tsx";

const DEMO: AuthUser = {
  id: "user_demo",
  email: "demo@example.test",
  name: "Demo",
  role: "member",
  readOnly: true,
};
const ADA: AuthUser = { id: "user_ada", email: "ada@example.test", name: "Ada", role: "member" };

/** The HTML of `path` for a signed-in `user` whose password and other sessions exist. */
async function page(path: string, user: AuthUser): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    auth: stubAuth(user, {
      hasPassword: async () => await Promise.resolve(true),
      listSessions: async () =>
        await Promise.resolve([
          {
            id: "s1",
            token: "t1",
            ipAddress: null,
            userAgent: "This browser",
            createdAt: "2026-01-14T09:00:00.000Z",
            expiresAt: "2026-02-14T09:00:00.000Z",
          },
          {
            id: "s2",
            token: "t2",
            ipAddress: null,
            userAgent: "Another browser",
            createdAt: "2026-01-14T10:00:00.000Z",
            expiresAt: "2026-02-14T10:00:00.000Z",
          },
        ]),
    }),
    logger: createShelfLogger({ level: "silent" }),
  });
  try {
    return await (await app.request(path)).text();
  } finally {
    await app.lifecycle.teardown();
  }
}

describe("read-only shared account UI (#1274)", () => {
  it("shows the banner on app pages for the read-only account only", async () => {
    expect(await page("/projects", DEMO)).toContain(READ_ONLY_BANNER_TITLE);
    expect(await page("/projects", ADA)).not.toContain(READ_ONLY_BANNER_TITLE);
  });

  it("hides every profile control that changes the account, and keeps sign-out", async () => {
    const html = await page("/profile", DEMO);
    expect(html).toContain(READ_ONLY_BANNER_TITLE);
    for (const action of [
      'action="/profile"',
      'action="/profile/password"',
      'action="/profile/sessions/revoke"',
      'action="/profile/sessions/revoke-others"',
      'action="/profile/notifications"',
      "data-passkey-register",
    ]) {
      expect(html, action).not.toContain(action);
    }
    expect(html).toContain('action="/auth/logout"');
  });

  it("keeps the profile controls for every other account", async () => {
    const html = await page("/profile", ADA);
    expect(html).toContain('action="/profile"');
    expect(html).toContain('action="/profile/password"');
    expect(html).toContain('action="/profile/sessions/revoke-others"');
  });
});
