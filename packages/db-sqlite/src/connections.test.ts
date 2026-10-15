import { createShelfLogger } from "@storyshelf/core/logger";
import { ConnectionModel } from "@storyshelf/core/models";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const silent = createShelfLogger({ level: "silent" });

async function setup() {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silent });
  await Promise.all(
    ["u1", "u2"].map(
      async (id) =>
        await db.insert(db.tables.users, {
          id,
          email: `${id}@example.com`,
          name: id,
          role: "member",
          createdAt: NOW,
        } as never),
    ),
  );
  return { db, model: new ConnectionModel(db, "connection-test-secret") };
}

describe("user connections on a real database", () => {
  it("keeps one connection per user and service, converging repeated connects", async () => {
    const { model } = await setup();
    await model.connect("u1", "fake", { accessToken: "a1", expiresAt: null });
    await model.connect("u1", "fake", { accessToken: "a2", expiresAt: null });
    await model.connect("u2", "fake", { accessToken: "b1", expiresAt: null });
    expect(await model.listForUser("u1")).toHaveLength(1);
    expect(await model.accessToken("u1", "fake")).toBe("a2");
    expect(await model.accessToken("u2", "fake")).toBe("b1");
  });

  it("rejects a duplicate (user, service) row at the database level", async () => {
    const { db, model } = await setup();
    await model.connect("u1", "fake", { accessToken: "a1", expiresAt: null });
    await expect(
      db.insert(db.tables.userConnections, {
        id: "dup",
        userId: "u1",
        service: "fake",
        tokenEncrypted: "x",
        status: "ok",
        createdAt: NOW,
        updatedAt: NOW,
      } as never),
    ).rejects.toThrow();
  });

  it("deletes a user's connections with the user", async () => {
    const { db, model } = await setup();
    await model.connect("u1", "fake", { accessToken: "a1", expiresAt: null });
    await db.remove(db.tables.users, "u1");
    expect(await model.info("u1", "fake")).toBeNull();
  });
});
