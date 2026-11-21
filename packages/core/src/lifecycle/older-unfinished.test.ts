import { describe, expect, it } from "vitest";
import type { BuildStatus } from "./build-lifecycle.ts";
import { selectOlderUnfinished } from "./older-unfinished.ts";

const at = (id: string, gitBranch: string, status: BuildStatus, second = 0) => ({
  id,
  gitBranch,
  status,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
});
const ids = (builds: { id: string }[]): string[] => builds.map((build) => build.id);

describe("selectOlderUnfinished", () => {
  const builds = [
    at("a", "main", "pending", 1),
    at("b", "main", "capturing", 2),
    at("c", "main", "pending", 3),
    at("d", "feat", "comparing", 1),
    at("e", "feat", "pending", 2),
    at("f", "main", "approved", 4),
    at("g", "main", "failed", 0),
  ];

  it("keeps the newest unfinished build of each branch and ignores finished ones", () => {
    expect(new Set(ids(selectOlderUnfinished(builds, 1)))).toEqual(new Set(["a", "b", "d"]));
  });

  it("keeps none with 0 and everything with a large number", () => {
    expect(selectOlderUnfinished(builds, 0)).toHaveLength(5);
    expect(selectOlderUnfinished(builds, 9)).toEqual([]);
  });

  it("breaks a createdAt tie by id", () => {
    const tied = [at("a", "main", "pending"), at("b", "main", "pending")];
    expect(ids(selectOlderUnfinished(tied, 1))).toEqual(["a"]);
  });
});
