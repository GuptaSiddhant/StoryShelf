import { PushSubscriptionModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { createECDH } from "node:crypto";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const me: AuthUser = { id: "u_me", email: "me@example.com", name: "Me", role: "member" };
const auth = stubAuth(null, { check: async () => me });

function keyPair() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}
const vapid = { ...keyPair(), subject: "mailto:ops@example.com" };
const keys = { p256dh: keyPair().publicKey, auth: Buffer.alloc(16, 5).toString("base64url") };

async function page(withKeys: boolean) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await Promise.all(
    [me, { ...me, id: "u_other", email: "o@example.com" }].map(async (user) =>
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
  const devices = new PushSubscriptionModel(db);
  await devices.add("u_me", {
    endpoint: "https://push.example.net/mine",
    ...keys,
    label: "Work laptop",
  });
  await devices.add("u_other", {
    endpoint: "https://push.example.net/theirs",
    ...keys,
    label: "Their phone",
  });
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    logger: pino({ level: "silent" }),
    ...(withKeys ? { notifications: { vapid } } : {}),
  });
  return await (await app.request("/profile/offline")).text();
}

describe("push card on /profile/offline", () => {
  it("is hidden without VAPID keys", async () => {
    const html = await page(false);
    expect(html).not.toContain("data-push");
    expect(html).not.toContain("Work laptop");
  });

  it("lists only the viewer's devices and never an endpoint or key", async () => {
    const html = await page(true);
    expect(html).toContain("Enable push on this device");
    expect(html).toContain("Work laptop");
    expect(html).not.toContain("Their phone");
    expect(html).not.toContain("push.example.net");
    expect(html).toContain("Add to Home Screen");
  });
});
