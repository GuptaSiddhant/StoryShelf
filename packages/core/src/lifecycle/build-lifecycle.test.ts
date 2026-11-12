import { describe, expect, it } from "vitest";
import { buildLifecycleContractSuite } from "../test-helpers/build-lifecycle-contract.ts";
import { makeDatabase } from "../test-helpers/fake-database.ts";
import {
  BUILD_EXITS,
  ENTRY_ONLY_BUILD_STATUSES,
  BUILD_STATUSES,
  CANCELLABLE_BUILD_STATUSES,
  OPEN_BUILD_STATUSES,
  TERMINAL_BUILD_STATUSES,
  allowedFrom,
  canMove,
  enteringFrom,
  exitFrom,
  isEntryOnly,
  isExit,
} from "./build-lifecycle.ts";

describe("build lifecycle table", () => {
  it("derives the status lists the code used to maintain by hand", () => {
    expect(TERMINAL_BUILD_STATUSES).toEqual([
      "approved",
      "rejected",
      "failed",
      "cancelled",
      "skipped",
    ]);
    expect(CANCELLABLE_BUILD_STATUSES).toEqual(["pending", "capturing", "comparing"]);
    expect(OPEN_BUILD_STATUSES).toEqual(["pending", "capturing", "comparing", "reviewing"]);
  });

  it("never moves out of a terminal state except through a named exit", () => {
    for (const from of TERMINAL_BUILD_STATUSES) {
      for (const to of BUILD_STATUSES) {
        const named = Object.keys(BUILD_EXITS).some((exit) =>
          isExit(exit as keyof typeof BUILD_EXITS, from, to),
        );
        const idempotent = from === to && !isEntryOnly(from);
        expect(canMove(from, to), `${from} → ${to}`).toBe(idempotent || named);
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
    for (const status of BUILD_STATUSES.filter((entry) => !isEntryOnly(entry))) {
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

describe("skipped builds (ADR 0044, decision 7)", () => {
  it("is entry-only and terminal", () => {
    expect(ENTRY_ONLY_BUILD_STATUSES).toEqual(["skipped"]);
    expect(TERMINAL_BUILD_STATUSES).toContain("skipped");
  });

  it("is not cancellable and not part of the open (resumed) set", () => {
    expect(CANCELLABLE_BUILD_STATUSES).not.toContain("skipped");
    expect(OPEN_BUILD_STATUSES).not.toContain("skipped");
  });

  it("is never moved to, from, or retried, whatever the status", () => {
    for (const other of BUILD_STATUSES) {
      expect(canMove(other, "skipped"), `${other} → skipped`).toBe(false);
      expect(canMove("skipped", other), `skipped → ${other}`).toBe(false);
    }
    expect(exitFrom("retry", "pending")).not.toContain("skipped");
    expect(allowedFrom("skipped")).toEqual([]);
  });
});

buildLifecycleContractSuite("fake database", () => makeDatabase().db);
