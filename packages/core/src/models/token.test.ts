import { describe, expect, it } from "vitest";
import { TokenModel } from "./token.ts";
import { makeDatabase } from "../capture/fake-adapters.ts";

describe("TokenModel", () => {
  it("creates a token for a project", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db);
    const token = await model.create("p1", "deploy-token", "abc123def456");
    expect(token.id).toBeDefined();
    expect(token.name).toBe("deploy-token");
    expect(token.hash).toBe("abc123def456");
  });

  it("gets a token by id", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db);
    const token = await model.create("p1", "api-key", "token-hash-xyz");
    const fetched = await model.get("p1", token.id);
    expect(fetched?.id).toBe(token.id);
    expect(fetched?.name).toBe("api-key");
    expect(fetched?.hash).toBe("token-hash-xyz");
  });

  it("lists tokens for a project", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db);
    await model.create("p1", "token-1", "hash-1");
    await model.create("p1", "token-2", "hash-2");
    const tokens = await model.list("p1");
    expect(tokens.length).toBe(2);
    expect(tokens.map((t) => t.name)).toContain("token-1");
    expect(tokens.map((t) => t.name)).toContain("token-2");
  });

  it("removes a token", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db);
    const token = await model.create("p1", "temp-token", "hash-temp");
    await model.remove(token.id);
    const tokens = await model.list("p1");
    expect(tokens.length).toBe(0);
  });

  it("finds a token by hash", async () => {
    const { db } = makeDatabase();
    const model = new TokenModel(db);
    const token = await model.create("p1", "active-token", "hash-active");
    const found = await model.findByHash("hash-active");
    expect(found?.id).toBe(token.id);
  });
});
