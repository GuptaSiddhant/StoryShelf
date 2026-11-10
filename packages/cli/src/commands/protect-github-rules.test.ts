import { describe, expect, it } from "vite-plus/test";
import { compareRules, requiredByRules, rulesetName } from "./protect-github-rules.ts";

const ctx = { repo: "acme/widgets", fetchImpl: fetch, headers: {} };
const target = { branch: "main", checks: ["storyshelf/testing"] };
const status = (...contexts: string[]) => ({
  type: "required_status_checks",
  parameters: { required_status_checks: contexts.map((context) => ({ context })) },
});

describe("requiredByRules", () => {
  it("collects the contexts of every status-check rule and ignores other rules", () => {
    expect(
      requiredByRules([status("a", "b"), { type: "deletion" }, status("c"), { type: "x" }]),
    ).toEqual(["a", "b", "c"]);
  });

  it("reads a status-check rule without parameters as requiring nothing", () => {
    expect(requiredByRules([{ type: "required_status_checks" }])).toEqual([]);
  });
});

describe("compareRules", () => {
  it("is satisfied when some rule requires every target check", () => {
    const result = compareRules(ctx, [status("ci", "storyshelf/testing")], target);
    expect(result).toMatchObject({ satisfied: true, mechanism: "rulesets" });
    expect(result.apply).toBeUndefined();
  });

  it("offers a write when a check is missing, and names what is required", () => {
    const result = compareRules(ctx, [{ type: "deletion" }], target);
    expect(result).toMatchObject({ satisfied: false, mechanism: "rulesets" });
    expect(result.summary).toContain("they require no status checks");
    expect(result.apply).toBeTypeOf("function");
  });

  it("names the ruleset it would create", () => {
    expect(rulesetName("main")).toBe("StoryShelf merge gate (main)");
    expect(rulesetName("release/1")).not.toBe(rulesetName("main"));
  });
});
