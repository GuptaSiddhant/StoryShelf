import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { UserModel } from "@storyshelf/core/models";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { describe, expect, it, vi } from "vitest";
import { buildAdapter, mirrorUser } from "./adapter-bridge.ts";
import type { ShelfAuthInstance, ShelfAuthOptions } from "./types.ts";

async function testDb(): Promise<DatabaseAdapter> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  return db;
}

const SECRET = "s".repeat(32);

function options(overrides: Partial<ShelfAuthOptions> = {}): ShelfAuthOptions {
  return {
    db: {} as DatabaseAdapter,
    secret: SECRET,
    baseURL: "https://shelf.example.com",
    ...overrides,
  };
}

function instance(overrides: Partial<ShelfAuthInstance["api"]> = {}): ShelfAuthInstance {
  return {
    handler: async () => await Promise.resolve(new Response("engine")),
    api: {
      getSession: async () => await Promise.resolve(null),
      signOut: async () => await Promise.resolve({}),
      ...overrides,
    },
  };
}

const CREATED = { id: "u1", email: "ada@example.com", name: "Ada", image: "https://img/a.png" };

describe("mirrorUser", () => {
  it("mirrors a new engine user as a member and fires sys:user-created once", async () => {
    const db = await testDb();
    const hook = vi.fn();
    await mirrorUser(db, CREATED, { onAuthSystemEvent: hook });
    expect(await new UserModel(db).get("u1")).toMatchObject({
      email: "ada@example.com",
      name: "Ada",
      avatarUrl: "https://img/a.png",
      role: "member",
    });
    expect(hook).toHaveBeenCalledWith("sys:user-created", {
      userId: "u1",
      email: "ada@example.com",
      name: "Ada",
    });
  });

  it("never demotes: a staged invitee keeps the role, and the hook does not fire again", async () => {
    const db = await testDb();
    await new UserModel(db).upsert({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      avatarUrl: null,
      role: "admin",
    });
    const hook = vi.fn();
    await mirrorUser(db, { ...CREATED, name: "Ada L." }, { onAuthSystemEvent: hook });
    expect(await new UserModel(db).get("u1")).toMatchObject({ role: "admin", name: "Ada L." });
    expect(hook).not.toHaveBeenCalled();
  });

  it("logs and swallows a failing hook", async () => {
    const db = await testDb();
    const logger = { warn: vi.fn() };
    await expect(
      mirrorUser(db, CREATED, {
        logger: logger as never,
        onAuthSystemEvent: () => {
          throw new Error("hook broke");
        },
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
      "auth system hook failed",
    );
  });
});

describe("buildAdapter", () => {
  it("passes requests to the engine handler", async () => {
    const adapter = buildAdapter(instance(), await testDb(), options());
    expect(await (await adapter.handler(new Request("https://x/api/auth/ok"))).text()).toBe(
      "engine",
    );
  });

  it("refuses a secret shorter than 32 characters at setup", async () => {
    const adapter = buildAdapter(instance(), await testDb(), options({ secret: "short" }));
    await expect(adapter.setup()).rejects.toThrow("at least 32 characters");
    await expect(
      buildAdapter(instance(), await testDb(), options()).setup(),
    ).resolves.toBeUndefined();
  });

  it("never mints a session itself", async () => {
    const adapter = buildAdapter(instance(), await testDb(), options());
    await expect(adapter.createSession({} as never)).rejects.toThrow(
      "minted by engine endpoints only",
    );
  });

  it("reports the configured login methods and passkey support", async () => {
    const plain = buildAdapter(instance(), await testDb(), options());
    expect(plain.loginMethods().map((method) => method.id)).toEqual(["password"]);
    expect(plain.passkeysEnabled()).toBe(false);
    const withPasskeys = buildAdapter(instance(), await testDb(), options({ passkeys: {} }));
    expect(withPasskeys.passkeysEnabled()).toBe(true);
  });

  it("check() is null for anonymous requests and for a disabled account", async () => {
    const db = await testDb();
    await new UserModel(db).upsert({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      avatarUrl: null,
      role: "admin",
    });
    const signedIn = instance({
      getSession: async () =>
        await Promise.resolve({ user: { id: "u1", email: "ada@example.com", name: "Ada" } }),
    });
    const adapter = buildAdapter(signedIn, db, options());
    expect(
      await buildAdapter(instance(), db, options()).check(new Request("https://x")),
    ).toBeNull();
    expect(await adapter.check(new Request("https://x"))).toMatchObject({
      id: "u1",
      role: "admin",
      providerId: "better-auth",
    });
    await adapter.setDisabled("u1", true);
    expect(await adapter.check(new Request("https://x"))).toBeNull();
  });

  it("check() falls back to the member role for a user with no mirrored row yet", async () => {
    const db = await testDb();
    const signedIn = instance({
      getSession: async () =>
        await Promise.resolve({ user: { id: "ghost", email: "g@x.y", name: "G" } }),
    });
    expect(
      await buildAdapter(signedIn, db, options()).check(new Request("https://x")),
    ).toMatchObject({
      id: "ghost",
      role: "member",
    });
  });

  it("check() refreshes IdP profile fields on drift but keeps the display override", async () => {
    const db = await testDb();
    await new UserModel(db).upsert({
      id: "u1",
      email: "old@x.y",
      name: "Old",
      avatarUrl: null,
      role: "member",
    });
    await new UserModel(db).setDisplayNameOverride("u1", "Mine");
    const signedIn = instance({
      getSession: async () =>
        await Promise.resolve({
          user: { id: "u1", email: "new@x.y", name: "New", image: "https://i/n.png" },
        }),
    });
    const user = await buildAdapter(signedIn, db, options()).check(new Request("https://x"));
    expect(user).toMatchObject({ email: "new@x.y", name: "Mine" });
    expect(await new UserModel(db).get("u1")).toMatchObject({
      email: "new@x.y",
      name: "New",
      avatarUrl: "https://i/n.png",
    });
  });

  it("destroySession ignores an empty token and survives a failing engine sign-out", async () => {
    const signOut = vi.fn(async () => await Promise.reject(new Error("engine down")));
    const adapter = buildAdapter(instance({ signOut }), await testDb(), options());
    await expect(adapter.destroySession("")).resolves.toBeUndefined();
    expect(signOut).not.toHaveBeenCalled();
    await expect(adapter.destroySession("tok.sig")).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
