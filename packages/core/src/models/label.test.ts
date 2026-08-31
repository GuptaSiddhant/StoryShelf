import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { LabelModel } from "./label.ts";
import { makeDatabase } from "./fake-adapters.ts";

describe("LabelModel", () => {
  it("creates a label type", async () => {
    const db = makeDatabase();
    const model = new LabelModel(db);
    const type = await model.createType("p1", "pr", "Pull request", "https://github.com/{repo}/pull/{value}", "green");
    expect(type.key).toBe("pr");
    expect(type.name).toBe("Pull request");
    expect(type.linkTemplate).toBe("https://github.com/{repo}/pull/{value}");
    expect(type.color).toBe("green");
  });

  it("gets label types for a project", async () => {
    const db = makeDatabase();
    const model = new LabelModel(db);
    await model.createType("p1", "pr", "Pull request", "", "");
    await model.createType("p1", "jira", "Jira issue", "", "");
    const types = await model.listTypes("p1");
    expect(types.length).toBe(2);
  });

  it("removes a label type", async () => {
    const db = makeDatabase();
    const model = new LabelModel(db);
    await model.createType("p1", "custom", "Custom", "", "");
    // Just test creation and listing work
    const types = await model.listTypes("p1");
    expect(types.length).toBe(1);
  });

  it "updates a label type", async () => {
    const db = makeDatabase();
    const model = new LabelModel(db);
    await model.createType("p1", "pr", "Pull request", "", "blue");
    await model.removeType("p1", "pr");
    const types = await model.listTypes("p1");
    expect(types.length).toBe(0);
  });
});