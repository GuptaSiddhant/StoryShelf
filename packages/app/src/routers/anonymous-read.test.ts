import { describe, expect, it } from "vitest";
import { anonymousTarget, publicBuildsOf } from "./anonymous-read.ts";

describe("anonymousTarget (the requests a visitor may make)", () => {
  it.each([
    ["/projects/demo", { slug: "demo" }],
    ["/projects/demo/", { slug: "demo" }],
    ["/projects/demo/builds", { slug: "demo" }],
    ["/projects/demo/builds/b1", { slug: "demo", buildId: "b1" }],
    ["/projects/demo/builds/b1/diff", { slug: "demo", buildId: "b1" }],
    ["/api/v1/projects/demo/builds/b1/snapshots/s1/image", { slug: "demo", buildId: "b1" }],
    ["/api/v1/projects/demo/builds/b1/snapshots/s1/diff", { slug: "demo", buildId: "b1" }],
    ["/api/v1/projects/demo/builds/b1/snapshots/s1/baseline", { slug: "demo", buildId: "b1" }],
  ])("reads %s", (path, target) => {
    expect(anonymousTarget("GET", path)).toEqual(target);
    expect(anonymousTarget("HEAD", path)).toEqual(target);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("never matches a %s", (method) => {
    expect(anonymousTarget(method, "/projects/demo/builds/b1/diff")).toBeNull();
  });

  it.each([
    "/projects/new",
    "/projects",
    "/projects/demo/library",
    "/projects/demo/settings",
    "/projects/demo/builds/b1/insights/panel",
    "/projects/demo/builds/b1/comments",
    "/projects/demo/builds/b1/diff/extra",
    "/api/v1/projects/demo/builds",
    "/api/v1/projects/demo/builds/b1",
    "/api/v1/projects/demo/builds/b1/snapshots/s1/approve",
    "/api/v1/projects/demo/design/renders/r1",
  ])("leaves %s to sign-in", (path) => {
    expect(anonymousTarget("GET", path)).toBeNull();
  });
});

/** A build row with the fields the check reads. */
function build(id: string, gitBranch: string, extra: object = {}) {
  return {
    id,
    gitBranch,
    public: false,
    status: "approved" as const,
    ...extra,
  };
}

describe("publicBuildsOf", () => {
  const project = { publicBranchRegex: "^main$" };

  it("keeps builds on a public branch or marked public, and never a skipped one", () => {
    const builds = [
      build("a", "main"),
      build("b", "feature/secret"),
      build("c", "feature/shown", { public: true }),
      build("d", "main", { status: "skipped" }),
    ];
    expect(publicBuildsOf(project, builds).map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("keeps nothing without a pattern or a public mark", () => {
    expect(publicBuildsOf({ publicBranchRegex: null }, [build("a", "main")])).toEqual([]);
  });
});
