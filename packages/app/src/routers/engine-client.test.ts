import { createShelfAuth, listUserSessions, type ShelfAuth } from "@storyshelf/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { TrustProxy } from "@storyshelf/core/config";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });
const BASE_URL = "http://localhost:3000";
const PASSWORD = "hunter2hunter2";

interface Harness {
  db: DatabaseAdapter;
  shelf: ShelfAuth;
  app: ReturnType<typeof createShelfApp>;
}

/** An app whose engine limiter is on, as in production, behind `trustProxy`. */
async function harness(trustProxy?: TrustProxy): Promise<Harness> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
  const shelf = createShelfAuth({
    db,
    secret: "spike-secret-that-is-long-enough-123456",
    baseURL: BASE_URL,
    rateLimit: { enabled: true },
  });
  const app = createShelfApp({
    database: db,
    storage: makeStorage().storage,
    auth: shelf.adapter,
    logger: silentLogger,
    config: {
      secret: "test-secret",
      publicBaseUrl: BASE_URL,
      ...(trustProxy === undefined ? {} : { trustProxy }),
    },
  });
  return { db, shelf, app };
}

/** One form sign-in at `/auth/engine/login` from socket `peer`, with extra headers. */
async function formSignIn(
  { app }: Harness,
  peer: string,
  headers: Record<string, string> = {},
  email = "nobody@example.com",
): Promise<Response> {
  const form = new FormData();
  form.set("email", email);
  form.set("password", PASSWORD);
  return await app.request(
    "/auth/engine/login",
    { method: "POST", headers: { origin: BASE_URL, ...headers }, body: form },
    { incoming: { socket: { remoteAddress: peer } } },
  );
}

/** Send enough sign-ins from `peer` to pass the engine's limit; answer the last status. */
async function overLimit(
  h: Harness,
  peer: string,
  headers: Record<string, string>,
): Promise<number> {
  let status = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // Attempts must run in sequence: the limiter counts them in order.
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design
    status = (await formSignIn(h, peer, headers)).status;
  }
  return status;
}

/** The header a trusted proxy adds for `client`. */
function via(client: string): Record<string, string> {
  return { "x-forwarded-for": client };
}

describe("engine sign-in is limited per client", () => {
  it("does not let one socket peer lock out another (no trustProxy)", async () => {
    const h = await harness();
    expect(await overLimit(h, "203.0.113.11", {})).toBe(429);
    expect((await formSignIn(h, "203.0.113.12")).status).toBe(401);
  });

  it("does not let one client behind a trusted proxy lock out another (trustProxy)", async () => {
    const h = await harness(["10.0.0.0/8"]);
    expect(await overLimit(h, "10.0.0.5", via("198.51.100.21"))).toBe(429);
    expect((await formSignIn(h, "10.0.0.5", via("198.51.100.22"))).status).toBe(401);
  });

  it("ignores a spoofed X-Forwarded-For when no proxy is trusted", async () => {
    const h = await harness();
    // Same socket peer, a new claimed address on every request: still one bucket.
    let last = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design
      last = (await formSignIn(h, "203.0.113.31", { "x-forwarded-for": `192.0.2.${attempt}` }))
        .status;
    }
    expect(last).toBe(429);
  });

  it("ignores a spoofed X-Forwarded-For from a peer that is not a trusted proxy", async () => {
    const h = await harness(["10.0.0.0/8"]);
    let last = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design
      last = (await formSignIn(h, "203.0.113.32", { "x-forwarded-for": `192.0.2.${attempt}` }))
        .status;
    }
    expect(last).toBe(429);
  });

  it("overwrites a spoofed header on the direct /api/auth mount too", async () => {
    const h = await harness();
    let last = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design
      const res = await h.app.request(
        "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: BASE_URL,
            "x-forwarded-for": `192.0.2.${attempt}`,
          },
          body: JSON.stringify({ email: "nobody@example.com", password: PASSWORD }),
        },
        { incoming: { socket: { remoteAddress: "203.0.113.33" } } },
      );
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("does not lock requests with no resolvable address out of each other", async () => {
    const h = await harness();
    // No socket and no forwarded header: the app can name no client, so the engine limit is skipped.
    let last = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const form = new FormData();
      form.set("email", "nobody@example.com");
      form.set("password", PASSWORD);
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design
      const res = await h.app.request("/auth/engine/login", {
        method: "POST",
        headers: { origin: BASE_URL },
        body: form,
      });
      last = res.status;
    }
    expect(last).toBe(401);
  });

  it("stores the resolved address on the session, never the claimed one", async () => {
    const h = await harness();
    const issued = await h.shelf.adapter.issueInvite({
      email: "ada@example.com",
      name: "Ada",
      role: "member",
    });
    const user = await h.shelf.adapter.acceptInvite({
      inviteId: issued.inviteId,
      token: issued.token,
      password: PASSWORD,
    });
    const res = await formSignIn(
      h,
      "203.0.113.34",
      { "x-forwarded-for": "192.0.2.99" },
      "ada@example.com",
    );
    expect(res.status).toBe(302);
    const sessions = await listUserSessions(h.db, user.id);
    expect(sessions.map((s) => s.ipAddress)).toEqual(["203.0.113.34"]);
  });
});
