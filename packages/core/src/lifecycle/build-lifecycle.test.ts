import { describe, expect, it } from "vite-plus/test";
import { buildLifecycleContractSuite } from "../test-helpers/build-lifecycle-contract.ts";
import { makeDatabase } from "../test-helpers/fake-database.ts";
import {
  BUILD_EXITS,
  BUILD_STATUSES,
  CANCELLABLE_BUILD_STATUSES,
  OPEN_BUILD_STATUSES,
  TERMINAL_BUILD_STATUSES,
  allowedFrom,
  canMove,
  enteringFrom,
  exitFrom,
  isExit,
} from "./build-lifecycle.ts";

describe("build lifecycle table", () => {
  it("derives the status lists the code used to maintain by hand", () => {
    expect(TERMINAL_BUILD_STATUSES).toEqual(["approved", "rejected", "failed", "cancelled"]);
    expect(CANCELLABLE_BUILD_STATUSES).toEqual(["pending", "capturing", "comparing"]);
    expect(OPEN_BUILD_STATUSES).toEqual(["pending", "capturing", "comparing", "reviewing"]);
  });

  it("never moves out of a terminal state except through a named exit", () => {
    for (const from of TERMINAL_BUILD_STATUSES) {
      for (const to of BUILD_STATUSES) {
        const named = Object.keys(BUILD_EXITS).some((exit) =>
          isExit(exit as keyof typeof BUILD_EXITS, from, to),
        );
        expect(canMove(from, to), `${from} → ${to}`).toBe(from === to || named);
      }
    }
  });

  it("keeps a cancelled build cancelled", () => {
    expect(allowedFrom("capturing")).not.toContain("cancelled");
    expect(allowedFrom("failed")).not.toContain("cancelled");
    expect(exitFrom("retry", "pending")).toContain("cancelled");
    expect(BUILD_STATUSES.filter((to) => to !== "pending" && canMove("cancelled", to))).toEqual([
      "cancelled",
    ]);
  });

  it("treats a write of the status a row already has as an idempotent no-op", () => {
    for (const status of BUILD_STATUSES) {
      expect(canMove(status, status)).toBe(true);
      expect(enteringFrom(status)).not.toContain(status);
      expect(allowedFrom(status)).toContain(status);
    }
  });

  it("lets a verdict move a reviewed build between verdicts but not a failed one", () => {
    expect(canMove("approved", "rejected")).toBe(true);
    expect(canMove("rejected", "approved")).toBe(true);
    expect(canMove("failed", "approved")).toBe(false);
    expect(canMove("failed", "reviewing")).toBe(false);
  });
});

buildLifecycleContractSuite("fake database", () => makeDatabase().db);
