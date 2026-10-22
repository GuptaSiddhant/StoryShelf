import { describe, expect, it } from "vitest";
import type { BuildComponent } from "../../schema/build-component.ts";
import type { Build } from "../../schema/build.ts";
import { catalogPresence, componentBuildHistory } from "./history.ts";

function build(id: string, createdAt: string, gitBranch = "main"): Build {
  return { id, gitBranch, createdAt, gitSha: id } as Build;
}

function row(
  buildId: string,
  hash: string,
  overrides: Partial<BuildComponent> = {},
): BuildComponent {
  return {
    id: `r-${buildId}`,
    projectId: "p",
    buildId,
    importPath: "src/A.tsx",
    title: "A",
    storyCount: 1,
    hash,
    createdAt: "",
    ...overrides,
  };
}

describe("componentBuildHistory", () => {
  const builds = [
    build("b1", "2026-01-01"),
    build("b2", "2026-01-02"),
    build("b3", "2026-01-03"),
    build("f1", "2026-01-02T12", "feature/x"),
  ];

  it("lists builds newest first and compares each with the one before on its branch", () => {
    const history = componentBuildHistory(
      [row("b1", "h1"), row("b2", "h1"), row("b3", "h2"), row("f1", "h9")],
      builds,
    );
    expect(history.map((entry) => [entry.build.id, entry.change])).toEqual([
      ["b3", "changed"],
      ["f1", "new"],
      ["b2", "unchanged"],
      ["b1", "new"],
    ]);
    expect(history[0]?.previous?.buildId).toBe("b2");
    expect(history[1]?.previous).toBeNull();
  });

  it("skips rows whose build is gone", () => {
    expect(componentBuildHistory([row("gone", "h")], builds)).toEqual([]);
  });
});

describe("catalogPresence", () => {
  const history = componentBuildHistory([row("b1", "h1")], [build("b1", "2026-01-01")]);

  it("is present when the latest build has the file", () => {
    expect(catalogPresence(history, "src/A.tsx", [row("b9", "h")])).toEqual({ kind: "present" });
  });

  it("finds a moved file by its title", () => {
    expect(
      catalogPresence(history, "src/A.tsx", [row("b9", "h", { importPath: "src/ui/A.tsx" })]),
    ).toEqual({ kind: "moved", to: "src/ui/A.tsx", title: "A" });
  });

  it("is deleted, with the last build that had it, when neither file nor title is there", () => {
    const presence = catalogPresence(history, "src/A.tsx", [
      row("b9", "h", { importPath: "src/B.tsx", title: "B" }),
    ]);
    expect(presence).toMatchObject({ kind: "deleted", lastSeen: { id: "b1" } });
  });

  it("is unknown without a latest catalog or without history", () => {
    expect(catalogPresence(history, "src/A.tsx", null)).toEqual({ kind: "unknown" });
    expect(catalogPresence([], "src/A.tsx", [])).toEqual({ kind: "unknown" });
  });
});
