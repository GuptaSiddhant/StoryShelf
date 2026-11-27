import { describe, expect, it } from "vitest";
import manifest from "../../../../config/version-manifest.json" with { type: "json" };
import { nodeVersionProblem } from "./node-version.ts";

const RANGE = manifest.packages["@storyshelf/app"].engines.node;

describe("nodeVersionProblem", () => {
  it("names the version found and the range needed on an older major", () => {
    expect(nodeVersionProblem("22.11.0")).toBe(
      `storyshelf-server: Node 22.11.0 is too old; Node ${RANGE} is required. Install a newer Node and run it again.`,
    );
  });

  it("accepts a version in the range", () => {
    expect(nodeVersionProblem("24.0.0")).toBeUndefined();
    expect(nodeVersionProblem("25.1.0")).toBeUndefined();
  });

  it("checks nothing when no range is known", () => {
    expect(nodeVersionProblem("1.0.0", null)).toBeUndefined();
  });
});
