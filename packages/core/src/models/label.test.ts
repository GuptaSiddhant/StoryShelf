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

  it("updates a label type", async () => {
    const { db } = makeDatabase();
    const model = new LabelModel(db);
    await model.createType("p1", { key: "pr", name: "Pull request", color: "blue" });
    await model.removeType("p1", "pr");
    const types = await model.listTypes("p1");
    expect(types.length).toBe(0);
  });
});
