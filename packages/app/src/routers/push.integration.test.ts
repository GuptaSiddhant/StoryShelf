import { PushSubscriptionModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { createECDH } from "node:crypto";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const users: Record<string, AuthUser> = {
  admin: { id: "u_admin", email: "a@example.com", name: "A", role: "admin" },
  member: { id: "u_member", email: "m@example.com", name: "M", role: "member" },
  other: { id: "u_other", email: "o@example.com", name: "O", role: "member" },
};

const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const name = /storyshelf_session=(\w+)/u.exec(cookie)?.[1] ?? "";
    return users[name] ?? null;
  },
});

const as = (name: string) => ({
  cookie: `storyshelf_session=${name}`,
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
});

function keyPair() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}

const vapid = { ...keyPair(), subject: "mailto:ops@example.com" };
const browser = keyPair();
const subscription = {
  endpoint: "https://push.example.net/p/abc",
  keys: { p256dh: browser.publicKey, auth: Buffer.alloc(16, 5).toString("base64url") },
  label: "Work laptop",
};

async function appWith(withKeys: boolean) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await Promise.all(
    Object.values(users).map(async (user) =>
      db.insert(db.tables.users, {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: null,
        role: user.role,
        lastLoginAt: null,
        createdAt: now,
        passwordHash: null,
        displayNameOverride: null,
        authProvider: "local",
        disabled: false,
      }),
    ),
  );
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    logger: pino({ level: "silent" }),
    ...(withKeys ? { notifications: { vapid } } : {}),
  });
  return { app, db };
}

describe("web push routes without VAPID keys", () => {
  it.each([
    ["GET", "/api/v1/push/public-key"],
    ["POST", "/api/v1/me/push-subscriptions"],
    ["DELETE", "/api/v1/me/push-subscriptions/anything"],
  ])("%s %s answers 404", async (method, path) => {
    const { app } = await appWith(false);
    const res = await app.request(path, {
      method,
      headers: as("member"),
      ...(method === "POST" ? { body: JSON.stringify(subscription) } : {}),
    });
    expect(res.status).toBe(404);
  });
});

describe("web push routes", () => {
  it("serves the public key to a signed-in user and never the private one", async () => {
    const { app } = await appWith(true);
    const res = await app.request("/api/v1/push/public-key", { headers: as("member") });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ publicKey: vapid.publicKey });
    expect(text).not.toContain(vapid.privateKey);
  });

  it.each(["admin", "member"])("lets a %s register and remove their own device", async (name) => {
    const { app, db } = await appWith(true);
    const created = await app.request("/api/v1/me/push-subscriptions", {
      method: "POST",
      headers: as(name),
      body: JSON.stringify(subscription),
    });
    expect(created.status).toBe(201);
    const text = await created.text();
    const body = JSON.parse(text) as { id: string; label: string };
    expect(body.label).toBe("Work laptop");
    expect(text).not.toContain("push.example.net");
    expect(text).not.toContain(browser.publicKey);
    const row = await new PushSubscriptionModel(db).findByEndpoint(subscription.endpoint);
    expect(row?.userId).toBe(users[name]?.id);

    const removed = await app.request(`/api/v1/me/push-subscriptions/${body.id}`, {
      method: "DELETE",
      headers: as(name),
    });
    expect(removed.status).toBe(204);
    expect(await new PushSubscriptionModel(db).findByEndpoint(subscription.endpoint)).toBeNull();
  });

  it("answers 401 to an anonymous caller", async () => {
    const { app } = await appWith(true);
    const post = await app.request("/api/v1/me/push-subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify(subscription),
    });
    expect(post.status).toBe(401);
    const del = await app.request("/api/v1/me/push-subscriptions/x", { method: "DELETE" });
    expect(del.status).toBe(401);
  });

  it("answers 404 for another person's device and leaves it", async () => {
    const { app, db } = await appWith(true);
    const created = await app.request("/api/v1/me/push-subscriptions", {
      method: "POST",
      headers: as("member"),
      body: JSON.stringify(subscription),
    });
    const { id } = (await created.json()) as { id: string };
    const res = await app.request(`/api/v1/me/push-subscriptions/${id}`, {
      method: "DELETE",
      headers: as("other"),
    });
    expect(res.status).toBe(404);
    expect(
      await new PushSubscriptionModel(db).findByEndpoint(subscription.endpoint),
    ).not.toBeNull();
  });

  it.each([
    ["an http endpoint", { endpoint: "http://push.example.net/p/abc" }],
    [
      "an endpoint over 512 characters",
      { endpoint: `https://push.example.net/${"a".repeat(500)}` },
    ],
    ["a p256dh that is not a P-256 point", { keys: { ...subscription.keys, p256dh: "AAAA" } }],
    ["an auth secret of the wrong size", { keys: { ...subscription.keys, auth: "AAAA" } }],
  ])("refuses %s with 422", async (_name, patch) => {
    const { app } = await appWith(true);
    const res = await app.request("/api/v1/me/push-subscriptions", {
      method: "POST",
      headers: as("member"),
      body: JSON.stringify({ ...subscription, ...patch }),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).not.toContain("push.example.net");
  });

  it("registers the same endpoint again as a replacement, not a second device", async () => {
    const { app, db } = await appWith(true);
    const send = async (label: string) =>
      await app.request("/api/v1/me/push-subscriptions", {
        method: "POST",
        headers: as("member"),
        body: JSON.stringify({ ...subscription, label }),
      });
    await send("one");
    await send("two");
    const rows = await new PushSubscriptionModel(db).listForUser(users["member"]?.id ?? "");
    expect(rows.map((row) => row.label)).toEqual(["two"]);
  });
});
