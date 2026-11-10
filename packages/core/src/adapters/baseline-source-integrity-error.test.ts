import { describe, expect, it } from "vite-plus/test";
import { BaselineSourceIntegrityError } from "./database.ts";

describe("BaselineSourceIntegrityError", () => {
  it("names the baseline, the build and the problem, and is an Error", () => {
    const error = new BaselineSourceIntegrityError("base-1", "build-2", "tombstoned");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BaselineSourceIntegrityError");
    expect(error).toMatchObject({
      baselineId: "base-1",
      buildId: "build-2",
      problem: "tombstoned",
    });
    expect(error.message).toBe(
      "Baseline base-1: its source build build-2 is being deleted (tombstoned)",
    );
  });

  it("says another project for a foreign source", () => {
    const error = new BaselineSourceIntegrityError("base-1", "build-9", "other-project");
    expect(error.message).toBe(
      "Baseline base-1: its source build build-9 belongs to another project",
    );
  });
});
