import { describe, expect, it } from "vitest";
import { LabelModel } from "./label.ts";
import { makeDatabase } from "../capture/fake-adapters.ts";

describe("LabelModel", () => {
  it("creates a label type", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    const type = await model.createType("p1", { key: "pr", name: "Pull request", linkTemplate: "https://github.com/{repo}/pull/{value}", color: "green" });
    expect(type.key).toBe("pr");
    expect(type.name).toBe("Pull request");
    expect(type.linkTemplate).toBe("https://github.com/{repo}/pull/{value}");
    expect(type.color).toBe("green");
  });

  it("gets label types for a project", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    await model.createType("p1", { key: "pr", name: "Pull request" });
    await model.createType("p1", { key: "jira", name: "Jira issue" });
    const types = await model.listTypes("p1");
    expect(types.length).toBe(2);
  });

  it("removes a label type", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    await model.createType("p1", { key: "custom", name: "Custom" });
    const types = await model.listTypes("p1");
    expect(types.length).toBe(1);
  });

  it("updates a label type name, template and color", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    await model.createType("p1", { key: "pr", name: "Pull request", color: "blue", linkTemplate: "https://github.com/{repo}/pull/{value}" });
    const updated = await model.updateType("p1", "pr", { name: "PR", linkTemplate: null, color: null });
    expect(updated?.name).toBe("PR");
    expect(updated?.linkTemplate).toBeNull();
    expect(updated?.color).toBeNull();
  });

  it("updateType returns null for a non-existent label type", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    const updated = await model.updateType("p1", "missing", { name: "X" });
    expect(updated).toBeNull();
  });

  it("updateType rejects reserved label types", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    await expect(model.updateType("p1", "persistent", { name: "X" })).rejects.toThrow("Label type 'persistent' cannot be updated.");
    await expect(model.updateType("p1", "build", { name: "X" })).rejects.toThrow("Label type 'build' cannot be updated.");
  });
});
