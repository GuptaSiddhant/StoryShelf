import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { GitHostProvider } from "../adapters/git-host/index.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { StatusConfigModel } from "./status-config.ts";

const SECRET = "test-secret-00000000";

function setup(): { db: ReturnType<typeof makeDatabase>["db"]; model: StatusConfigModel } {
  const { db } = makeDatabase();
  return {
    db,
    model: new StatusConfigModel(
      db,
      { projectStatusConfigs: db.tables.projectStatusConfigs },
      SECRET,
    ),
  };
}

describe("StatusConfigModel", () => {
  it("creates a config with an encrypted token", async () => {
    const { model } = setup();
    const row = await model.create("p1", {
      provider: "github",
      config: { owner: "acme", repo: "widgets" },
      token: "ghp_test",
    });
    expect(row.id).toBeDefined();
    expect(row.provider).toBe("github");
    expect(row.tokenEncrypted).not.toBe("ghp_test");
    expect(model.decryptToken(row)).toBe("ghp_test");
  });

  it("lists configs scoped to the project", async () => {
    const { model } = setup();
    await model.create("p1", { provider: "github", config: {}, token: "t1" });
    await model.create("p2", { provider: "gitlab", config: {}, token: "t2" });
    const listed = await model.list("p1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.provider).toBe("github");
  });

  it("gets by id scoped to the project", async () => {
    const { model } = setup();
    const row = await model.create("p1", { provider: "github", config: {}, token: "t1" });
    await expect(model.get("p1", row.id)).resolves.toMatchObject({ id: row.id });
    await expect(model.get("p2", row.id)).resolves.toBeNull();
    await expect(model.get("p1", "missing")).resolves.toBeNull();
  });

  it("parses the stored JSON config", async () => {
    const { model } = setup();
    const row = await model.create("p1", {
      provider: "github",
      config: { owner: "acme", repo: "widgets" },
      token: "t1",
    });
    expect(StatusConfigModel.parseConfig(row)).toEqual({ owner: "acme", repo: "widgets" });
  });

  it("removes a config by id", async () => {
    const { model } = setup();
    const row = await model.create("p1", { provider: "github", config: {}, token: "t1" });
    await model.remove("p1", row.id);
    await expect(model.list("p1")).resolves.toHaveLength(0);
  });

  it("remove is a no-op for unknown ids", async () => {
    const { model } = setup();
    await expect(model.remove("p1", "missing")).resolves.toBeUndefined();
  });

  it("removeByProject clears every config of the project", async () => {
    const { model } = setup();
    await model.create("p1", { provider: "github", config: {}, token: "t1" });
    await model.create("p1", { provider: "gitlab", config: {}, token: "t2" });
    await model.create("p2", { provider: "github", config: {}, token: "t3" });
    await model.removeByProject("p1");
    await expect(model.list("p1")).resolves.toHaveLength(0);
    await expect(model.list("p2")).resolves.toHaveLength(1);
  });

  it("validates status-config input against the provider schema", () => {
    const provider = {
      metadata: { kind: "github", schema: z.object({ owner: z.string() }) },
    } as unknown as GitHostProvider;
    const ok = StatusConfigModel.validateInput([provider], "github", { owner: "acme" });
    expect(ok).toMatchObject({ ok: true, config: { owner: "acme" } });
    expect(StatusConfigModel.validateInput([provider], "gitlab", {})).toMatchObject({
      ok: false,
      field: "provider",
    });
    expect(StatusConfigModel.validateInput([provider], "github", {})).toMatchObject({
      ok: false,
      field: "config",
    });
  });

  it("resolves a row to provider, validated config and decrypted token", async () => {
    const { model } = setup();
    const provider = {
      metadata: { kind: "github", schema: z.object({ owner: z.string() }) },
    } as unknown as GitHostProvider;
    const row = await model.create("p1", {
      provider: "github",
      config: { owner: "a" },
      token: "t",
    });
    expect(model.resolveRow(row, [provider])).toMatchObject({
      ok: true,
      provider,
      config: { owner: "a" },
      token: "t",
    });
    expect(model.resolveRow(row, [])).toEqual({ ok: false, reason: "no-provider" });
    const badConfig = await model.create("p1", { provider: "github", config: {}, token: "t" });
    expect(model.resolveRow(badConfig, [provider])).toMatchObject({
      ok: false,
      reason: "invalid-config",
    });
    const otherKey = new StatusConfigModel(
      setup().db,
      { projectStatusConfigs: setup().db.tables.projectStatusConfigs },
      "a-different-secret-0000",
    );
    expect(otherKey.resolveRow(row, [provider])).toMatchObject({
      ok: false,
      reason: "undecryptable-token",
    });
  });
});
