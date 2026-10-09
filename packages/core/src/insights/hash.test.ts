import { describe, expect, it } from "vitest";
import { computeInputHash } from "./hash.ts";

const base = {
  evidenceText: "e",
  imageDigests: ["i1"],
  promptVersion: "v1",
  task: "triage",
  profile: "default",
  model: "m",
};

describe("computeInputHash", () => {
  it("is stable and sensitive to every part", () => {
    const h = computeInputHash(base);
    expect(computeInputHash({ ...base })).toBe(h);
    for (const change of [
      { evidenceText: "f" },
      { imageDigests: [] },
      { promptVersion: "v2" },
      { task: "health" },
      { profile: "x" },
      { model: "n" },
    ]) {
      expect(computeInputHash({ ...base, ...change })).not.toBe(h);
    }
  });
});
