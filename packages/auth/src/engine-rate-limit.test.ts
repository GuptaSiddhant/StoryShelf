import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createSqliteDatabase } from "@storyshelf/db/sqlite";
import { describe, expect, it } from "vitest";
import { createShelfAuth, type ShelfAuth } from "./engine.ts";
import { listUserSessions } from "./sessions.ts";

const BASE_URL = "http://localhost:3000";
const PASSWORD = "hunter2hunter2";

async function limitedEngine(enabled = true): Promise<{ db: DatabaseAdapter; shelf: ShelfAuth }> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  const shelf = createShelfAuth({
    db,
    secret: "spike-secret-that-is-long-enough-123456",
    baseURL: BASE_URL,
    rateLimit: { enabled },
  });
  return { db, shelf };
}

/** One `POST /sign-in/email`, as a client the app named with `client` (no header when undefined). */
async function signIn(
  shelf: ShelfAuth,
  client: string | null,
  email = "nobody@example.com",
): Promise<Response> {
  return await shelf.auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        ...(client === null ? {} : { "x-forwarded-for": client }),
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
}

/** Send requests from `client` until the engine answers 429 (at most `limit + 1`); answer the statuses. */
async function exhaust(shelf: ShelfAuth, client: string | null): Promise<number[]> {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // Sequential on purpose: the limiter counts requests in order.
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design
    statuses.push((await signIn(shelf, client)).status);
  }
  return statuses;
}

describe("engine sign-in rate limit", () => {
  it("limits each client on its own, so one client at the limit does not lock out another", async () => {
    const { shelf } = await limitedEngine();
    const noisy = await exhaust(shelf, "203.0.113.7");
    expect(noisy.slice(0, 3)).not.toContain(429);
    expect(noisy.slice(3)).toEqual([429, 429, 429]);

    const other = await signIn(shelf, "203.0.113.8");
    expect(other.status).not.toBe(429);
  });

  it("reads only x-forwarded-for: other client headers never choose the key", async () => {
    const { shelf } = await limitedEngine();
    await exhaust(shelf, "203.0.113.7");
    const res = await shelf.auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE_URL,
          "x-forwarded-for": "203.0.113.7",
          "x-real-ip": "198.51.100.1",
          "cf-connecting-ip": "198.51.100.2",
        },
        body: JSON.stringify({ email: "nobody@example.com", password: PASSWORD }),
      }),
    );
    expect(res.status).toBe(429);
  });

  it("skips the engine limit for requests that name no client, so none can lock out another", async () => {
    const { shelf } = await limitedEngine();
    const statuses = await exhaust(shelf, null);
    expect(statuses).not.toContain(429);
    expect((await signIn(shelf, "203.0.113.40")).status).not.toBe(429);
  });

  it("treats a header that is not one IP address as naming no client", async () => {
    const { shelf } = await limitedEngine();
    for (const claimed of ["not-an-ip", "203.0.113.41, 203.0.113.42"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design
      expect(await exhaust(shelf, claimed)).not.toContain(429);
    }
  });

  it("stores the address the app named on the session", async () => {
    const { db, shelf } = await limitedEngine(false);
    const issued = await shelf.adapter.issueInvite({
      email: "ada@example.com",
      name: "Ada",
      role: "member",
    });
    const user = await shelf.adapter.acceptInvite({
      inviteId: issued.inviteId,
      token: issued.token,
      password: PASSWORD,
    });
    const res = await signIn(shelf, "203.0.113.9", "ada@example.com");
    expect(res.status).toBe(200);
    const sessions = await listUserSessions(db, user.id);
    expect(sessions.map((s) => s.ipAddress)).toEqual(["203.0.113.9"]);
  });
});
