import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { StatusConfigModel } from "./status-config.ts";

const SECRET = "test-secret-00000000";

function setup(): { db: ReturnType<typeof makeDatabase>["db"]; model: StatusConfigModel } {
  const { db } = makeDatabase();
  return { db, model: new StatusConfigModel(db, SECRET) };
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
});
