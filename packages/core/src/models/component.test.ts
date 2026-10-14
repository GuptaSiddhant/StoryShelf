import { describe, expect, it } from "vitest";
import type { Build } from "../schema/build.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import type { SnapshotStatus } from "../types.ts";
import { componentHistory, componentPresence, worstStatus } from "./component.ts";

const build = (id: string, createdAt: string): Build => ({ id, createdAt }) as Build;
const snap = (id: string, buildId: string, storyId: string, status: SnapshotStatus): Snapshot =>
  ({ id, buildId, storyId, status, storyTitle: "T", storyImportPath: "./a.tsx" }) as Snapshot;

describe("worstStatus", () => {
  it("ranks rejected > changed > new > pending > approved > unchanged", () => {
    expect(worstStatus(["unchanged", "approved", "changed"])).toBe("changed");
    expect(worstStatus(["new", "approved"])).toBe("new");
    expect(worstStatus(["changed", "rejected"])).toBe("rejected");
    expect(worstStatus(["unchanged", "pending"])).toBe("pending");
    expect(worstStatus([])).toBe("unchanged");
  });
});

describe("componentHistory", () => {
  const builds = [build("b1", "2026-01-01"), build("b2", "2026-01-02"), build("b3", "2026-01-03")];
  const snaps = [
    snap("s1", "b1", "a--x", "approved"),
    snap("s2", "b2", "a--x", "changed"),
    snap("s3", "b2", "a--y", "unchanged"),
    snap("s4", "b2", "a--y", "unchanged"),
  ];

  it("lists builds that touch the file, newest first, with roll-ups", () => {
    const rows = componentHistory(snaps, builds);
    expect(rows.map((row) => row.build.id)).toEqual(["b2", "b1"]);
    expect(rows[0]).toMatchObject({
      states: 2,
      changedStates: 1,
      status: "changed",
      snapshotId: "s2",
    });
    expect(rows[1]).toMatchObject({
      states: 1,
      changedStates: 0,
      status: "approved",
      snapshotId: "s1",
    });
  });
});

describe("componentPresence", () => {
  const history = componentHistory(
    [snap("s1", "b1", "a--x", "approved")],
    [build("b1", "2026-01-01")],
  );

  it("is unknown without history and present on the latest build", () => {
    expect(componentPresence([], "b9", [], null)).toEqual({ kind: "unknown" });
    expect(componentPresence(history, "b1", [], "T")).toEqual({ kind: "present" });
  });

  it("resolves a moved file by its last-seen title, else reports deleted", () => {
    const latest = [{ storyTitle: "T", storyImportPath: "./moved.tsx" }];
    expect(componentPresence(history, "b9", latest, "T")).toEqual({
      kind: "moved",
      to: "./moved.tsx",
      title: "T",
    });
    const gone = componentPresence(
      history,
      "b9",
      [{ storyTitle: "Other", storyImportPath: "./o.tsx" }],
      "T",
    );
    expect(gone).toMatchObject({ kind: "deleted", lastSeen: { id: "b1" } });
  });
});
