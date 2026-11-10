import { describe, expect, it, vi } from "vite-plus/test";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { UserFacingError } from "../utils/user-facing-error.ts";
import { LabelModel } from "./label.ts";

describe("LabelModel", () => {
  it("creates a label type", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db, {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      labelTypes: db.tables.labelTypes,
    });
    const type = await model.createType("p1", {
      key: "pr",
      name: "Pull request",
      linkTemplate: "https://github.com/{repo}/pull/{value}",
      color: "green",
    });
    expect(type.key).toBe("pr");
    expect(type.name).toBe("Pull request");
    expect(type.linkTemplate).toBe("https://github.com/{repo}/pull/{value}");
    expect(type.color).toBe("green");
  });

  it("gets label types for a project", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db, {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      labelTypes: db.tables.labelTypes,
    });
    await model.createType("p1", { key: "pr", name: "Pull request" });
    await model.createType("p1", { key: "jira", name: "Jira issue" });
    const types = await model.listTypes("p1");
    expect(types.length).toBe(2);
  });

  it("seeds default link templates for pr and mr only", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    await model.seedFor("p1");
    const types = await model.listTypes("p1");
    const templates = Object.fromEntries(types.map((t) => [t.key, t.linkTemplate ?? null]));
    expect(templates["pr"]).toBe("https://github.com/{repo}/pull/{value}");
    expect(templates["mr"]).toBe("https://gitlab.com/{repo}/-/merge_requests/{value}");
    expect(templates["jira"]).toBeNull();
  });

  it("removes a label type", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db, {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      labelTypes: db.tables.labelTypes,
    });
    await model.createType("p1", { key: "custom", name: "Custom" });
    const types = await model.listTypes("p1");
    expect(types.length).toBe(1);
  });

  it("updates a label type name, template and color", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db, {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      labelTypes: db.tables.labelTypes,
    });
    await model.createType("p1", {
      key: "pr",
      name: "Pull request",
      color: "blue",
      linkTemplate: "https://github.com/{repo}/pull/{value}",
    });
    const updated = await model.updateType("p1", "pr", {
      name: "PR",
      linkTemplate: null,
      color: null,
    });
    expect(updated?.name).toBe("PR");
    expect(updated?.linkTemplate).toBeNull();
    expect(updated?.color).toBeNull();
  });

  it("updateType returns null for a non-existent label type", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db, {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      labelTypes: db.tables.labelTypes,
    });
    const updated = await model.updateType("p1", "missing", { name: "X" });
    expect(updated).toBeNull();
  });

  it("updateType rejects reserved label types", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db, {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      labelTypes: db.tables.labelTypes,
    });
    await expect(model.updateType("p1", "persistent", { name: "X" })).rejects.toThrow(
      "Label type 'persistent' cannot be updated.",
    );
    await expect(model.updateType("p1", "build", { name: "X" })).rejects.toThrow(
      "Label type 'build' cannot be updated.",
    );
  });

  it("its deliberate refusals are user-facing errors", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    await expect(model.updateType("p1", "persistent", { name: "X" })).rejects.toBeInstanceOf(
      UserFacingError,
    );
    await expect(model.removeType("p1", "persistent")).rejects.toBeInstanceOf(UserFacingError);
  });

  it("createType refuses a key the project already has, as a user-facing error", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    await model.createType("p1", { key: "pr", name: "Pull request" });
    const refused = await model
      .createType("p1", { key: "pr", name: "Again" })
      .catch((caught: unknown) => caught);
    expect(refused).toBeInstanceOf(UserFacingError);
    expect((refused as Error).message).toBe("A label type with the key 'pr' already exists.");
    expect(await model.listTypes("p1")).toHaveLength(1);
    // The same key in another project is a different label type.
    await model.createType("p2", { key: "pr", name: "Pull request" });
    expect(await model.listTypes("p2")).toHaveLength(1);
  });

  it("createType refuses as a duplicate when its insert loses a race for the key", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    const insert = db.insert.bind(db);
    const driverError = new Error(
      "UNIQUE constraint failed: label_types.project_id, label_types.key",
    );
    // The other request lands between this one's check and its insert, and the unique index turns this one away.
    vi.spyOn(db, "insert").mockImplementationOnce(async (table, values) => {
      await insert(table, { ...values, id: "winner" } as never);
      throw driverError;
    });

    const refused = await model
      .createType("p1", { key: "pr", name: "Mine" })
      .catch((caught: unknown) => caught);

    expect(refused).toBeInstanceOf(UserFacingError);
    expect((refused as Error).message).toBe("A label type with the key 'pr' already exists.");
    expect((refused as Error).cause).toBe(driverError);
    expect(await model.listTypes("p1")).toHaveLength(1);
  });

  it("createType rethrows a failed insert that is not a taken key as it is", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    const broken = new Error("SQLITE_BUSY: database is locked");
    vi.spyOn(db, "insert").mockRejectedValueOnce(broken);

    const failed = await model
      .createType("p1", { key: "pr", name: "Mine" })
      .catch((caught: unknown) => caught);

    expect(failed).toBe(broken);
    expect(failed).not.toBeInstanceOf(UserFacingError);
  });

  it("lists the project's persistent build ids", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    await model.attach("p1", "b1", "persistent", "true");
    await model.attach("p1", "b2", "pr", "12");
    await model.attach("p2", "b3", "persistent", "true");
    expect(await model.persistentBuildIds("p1")).toEqual(new Set(["b1"]));
  });
});
