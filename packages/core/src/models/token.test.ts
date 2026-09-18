import { describe, expect, it } from "vitest";
import { tokens } from "../../../db-sqlite/src/schema/index.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { TokenModel } from "./token.ts";

describe("TokenModel", () => {
  it("creates a token for a project", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db, { tokens });
    const token = await model.create("p1", {
      name: "deploy-token",
      hash: "abc123def456",
      userId: "user_1",
    });
    expect(token.id).toBeDefined();
    expect(token.name).toBe("deploy-token");
    expect(token.hash).toBe("abc123def456");
  });

  it("gets a token by id", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db, { tokens });
    const token = await model.create("p1", {
      name: "api-key",
      hash: "token-hash-xyz",
      userId: "user_1",
    });
    const fetched = await model.get("p1", token.id);
    expect(fetched?.id).toBe(token.id);
    expect(fetched?.name).toBe("api-key");
    expect(fetched?.hash).toBe("token-hash-xyz");
  });

  it("lists tokens for a project", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db, { tokens });
    await model.create("p1", { name: "token-1", hash: "hash-1" });
    await model.create("p1", { name: "token-2", hash: "hash-2" });
    const listed = await model.list("p1");
    expect(listed.length).toBe(2);
    expect(listed.map((t) => t.name)).toContain("token-1");
    expect(listed.map((t) => t.name)).toContain("token-2");
  });

  it("removes a token", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db, { tokens });
    const token = await model.create("p1", { name: "temp-token", hash: "hash-temp" });
    await model.remove(token.id);
    const listed = await model.list("p1");
    expect(listed.length).toBe(0);
  });

  it("finds a token by hash", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db, { tokens });
    const token = await model.create("p1", { name: "active-token", hash: "hash-active" });
    const found = await model.findByHash("hash-active");
    expect(found?.id).toBe(token.id);
  });

  it("stores a null userId when no owner is given", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db, { tokens });
    const token = await model.create("p1", { name: "legacy-token", hash: "hash-legacy" });
    expect(token.userId).toBeNull();
  });
});
