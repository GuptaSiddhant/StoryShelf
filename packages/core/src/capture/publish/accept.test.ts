import { describe, expect, it } from "vitest";
import { publishVerdict, type PublishFacts } from "./accept.ts";

const base: PublishFacts = {
  published: true,
  captureWillRun: false,
  defaultBranch: true,
  status: "pending",
};

describe("publishVerdict", () => {
  it("approves a published default-branch build when no capture will run", () => {
    expect(publishVerdict(base)).toBe("approved");
  });

  it("fails a build whose publishing failed, on any branch", () => {
    expect(publishVerdict({ ...base, published: false })).toBe("failed");
    expect(publishVerdict({ ...base, published: false, defaultBranch: false })).toBe("failed");
  });

  it("leaves a published non-default build pending", () => {
    expect(publishVerdict({ ...base, defaultBranch: false })).toBe("unchanged");
  });

  it("never touches the status when a capture will run", () => {
    expect(publishVerdict({ ...base, captureWillRun: true })).toBe("unchanged");
    expect(publishVerdict({ ...base, captureWillRun: true, published: false })).toBe("unchanged");
  });

  it("is idempotent: a build that left pending keeps its status", () => {
    for (const status of ["approved", "failed", "reviewing", "rejected", "capturing"]) {
      expect(publishVerdict({ ...base, status })).toBe("unchanged");
      expect(publishVerdict({ ...base, status, published: false })).toBe("unchanged");
    }
  });
});
