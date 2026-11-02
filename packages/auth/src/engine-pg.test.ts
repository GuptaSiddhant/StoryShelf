import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { UserModel } from "@storyshelf/core/models";
import { createPgliteDatabase } from "@storyshelf/db-postgres/pglite";
import { afterAll, describe, expect, it } from "vitest";
import { createShelfAuth, type ShelfAuth } from "./engine.ts";

/**
 * Account disabling against the Postgres adapter (PGlite, hermetic).
 *
 * The SQLite suite in `engine.test.ts` proves a disabled user loses access; this
 * one proves the same on Postgres, where the `disabled` flag must actually be
 * stored: a column missing from the table silently drops it and locks nobody out.
 */
const BASE_URL = "http://localhost:3000";
const PASSWORD = "hunter2hunter2";
const databases: DatabaseAdapter[] = [];

afterAll(async () => {
  for (const db of databases.splice(0)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- teardown order does not matter, keep it simple
    await db.lifecycle?.teardown();
  }
});

async function pgEngine(): Promise<{ db: DatabaseAdapter; shelf: ShelfAuth }> {
  const db = createPgliteDatabase();
  databases.push(db);
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  const shelf = createShelfAuth({
    db,
    secret: "spike-secret-that-is-long-enough-123456",
    baseURL: BASE_URL,
  });
  return { db, shelf };
}

async function signIn(shelf: ShelfAuth, email: string): Promise<Response> {
  return await shelf.auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
}

/** Whether the session a sign-in returned is accepted (null when sign-in itself was refused). */
async function accessGranted(shelf: ShelfAuth, signin: Response): Promise<boolean> {
  if (signin.status !== 200) {
    return false;
  }
  const cookie = (signin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const user = await shelf.adapter.check(new Request(`${BASE_URL}/`, { headers: { cookie } }));
  return user !== null;
}

async function invite(shelf: ShelfAuth, email: string, name: string): Promise<void> {
  const issued = await shelf.adapter.issueInvite({ email, name, role: "member" });
  await shelf.adapter.acceptInvite({
    inviteId: issued.inviteId,
    token: issued.token,
    password: PASSWORD,
  });
}

describe("account disabling on Postgres", () => {
  it("locks a disabled user out and restores access on re-enable", async () => {
    const { shelf } = await pgEngine();
    await invite(shelf, "zed@example.com", "Zed");
    const first = await signIn(shelf, "zed@example.com");
    expect(first.status).toBe(200);
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const request = new Request(`${BASE_URL}/`, { headers: { cookie } });
    const user = await shelf.adapter.check(request);
    expect(user).not.toBeNull();
    const userId = user?.id ?? "";

    await shelf.adapter.setDisabled(userId, true);
    // The existing session is rejected and revoked...
    await expect(shelf.adapter.check(request)).resolves.toBeNull();
    await expect(shelf.adapter.listSessions(userId)).resolves.toEqual([]);
    // ...and signing in again does not get them back in.
    await expect(accessGranted(shelf, await signIn(shelf, "zed@example.com"))).resolves.toBe(false);

    await shelf.adapter.setDisabled(userId, false);
    await expect(accessGranted(shelf, await signIn(shelf, "zed@example.com"))).resolves.toBe(true);
  }, 60_000);

  it("persists the disabled flag, the auth provider and the display-name override", async () => {
    const { db, shelf } = await pgEngine();
    await invite(shelf, "ada@example.com", "Ada");
    const signin = await signIn(shelf, "ada@example.com");
    const cookie = (signin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const user = await shelf.adapter.check(new Request(`${BASE_URL}/`, { headers: { cookie } }));
    const userId = user?.id ?? "";
    const users = new UserModel(db);

    await expect(users.get(userId)).resolves.toMatchObject({
      authProvider: "local",
      disabled: false,
    });
    await users.setDisplayNameOverride(userId, "Ada L.");
    await shelf.adapter.setDisabled(userId, true);
    await expect(users.get(userId)).resolves.toMatchObject({
      displayNameOverride: "Ada L.",
      disabled: true,
    });
  }, 60_000);
});
