import { describe, expect, it } from "vitest";
import { createUrlBuilder } from "../../urls.ts";
import {
  statusesForBuild,
  type BuildStateBuild,
  type BuildStateFlags,
  type PublishingState,
} from "./build-state.ts";

const build = (overrides: Partial<BuildStateBuild> = {}): BuildStateBuild => ({
  id: "b1",
  gitSha: "abc123",
  status: "pending",
  snapshotCount: 10,
  changedCount: 4,
  approvedCount: 1,
  rejectedCount: 0,
  ...overrides,
});

function run(
  overrides: {
    build?: Partial<BuildStateBuild>;
    flags?: Partial<BuildStateFlags>;
    publishing?: PublishingState;
    prefix?: string;
    base?: string;
  } = {},
) {
  return statusesForBuild({
    build: build(overrides.build),
    projectSlug: "web",
    prefix: overrides.prefix ?? "storyshelf",
    urls: createUrlBuilder(overrides.base ?? "https://shelf.example.com/"),
    flags: { testing: true, review: false, ...overrides.flags },
    publishing: overrides.publishing ?? "success",
  });
}

const gate = (set: ReturnType<typeof run>) =>
  set.statuses.find((status) => status.name !== "storybook");

describe("statusesForBuild: the testing status", () => {
  it.each([
    ["pending", "pending", "Capturing and comparing screenshots"],
    ["capturing", "pending", "Capturing and comparing screenshots"],
    ["comparing", "pending", "Capturing and comparing screenshots"],
    ["reviewing", "pending", "Review open: 1 change to review"],
    ["approved", "success", "Review closed: 1 change approved"],
    ["rejected", "failure", "Review closed: 2 changes rejected"],
    ["failed", "failure", "Capture failed"],
  ])("%s -> %s", (status, state, description) => {
    const set = run({ build: { status, rejectedCount: 2 } });
    expect(gate(set)).toMatchObject({
      name: "testing",
      context: "storyshelf/testing",
      state,
      description,
      url: "https://shelf.example.com/projects/web/builds/b1",
    });
  });

  it("says no visual changes when an approved build had none", () => {
    const set = run({ build: { status: "approved", changedCount: 0, approvedCount: 0 } });
    expect(gate(set)?.description).toBe("Review closed: no visual changes");
  });
});

describe("statusesForBuild: which statuses exist", () => {
  it("posts review instead of testing when testing is off and review is on", () => {
    const set = run({ flags: { testing: false, review: true }, build: { status: "approved" } });
    expect(set.statuses.map((status) => status.context)).toEqual([
      "storyshelf/review",
      "storyshelf/storybook",
    ]);
    expect(gate(set)).toMatchObject({ state: "success", description: "Build approved" });
  });

  it("maps the review verdict", () => {
    const flags = { testing: false, review: true };
    expect(gate(run({ flags, build: { status: "pending" } }))?.state).toBe("pending");
    expect(gate(run({ flags, build: { status: "rejected" } }))?.state).toBe("failure");
    expect(gate(run({ flags, build: { status: "failed" } }))?.state).toBe("failure");
  });

  it("prefers testing when both are on", () => {
    const set = run({ flags: { testing: true, review: true } });
    expect(set.statuses.map((status) => status.name)).toEqual(["testing", "storybook"]);
  });

  it("posts only storybook with neither testing nor review", () => {
    const set = run({ flags: { testing: false, review: false } });
    expect(set.statuses.map((status) => status.name)).toEqual(["storybook"]);
    expect(set.comment?.state).toBe("success");
  });
});

describe("statusesForBuild: storybook", () => {
  it("links the published Storybook once published", () => {
    const status = run({ publishing: "success" }).statuses.at(-1);
    expect(status).toMatchObject({
      context: "storyshelf/storybook",
      state: "success",
      url: "https://shelf.example.com/projects/web/storybook/build/b1/",
    });
  });

  it("is pending while publishing and failed when it failed, linking the build", () => {
    expect(run({ publishing: "pending" }).statuses.at(-1)).toMatchObject({
      state: "pending",
      url: "https://shelf.example.com/projects/web/builds/b1",
    });
    expect(run({ publishing: "failure" }).statuses.at(-1)).toMatchObject({
      state: "failure",
      description: "Storybook could not be published",
    });
  });
});

const contexts = (prefix: string) => run({ prefix }).statuses.map((status) => status.context);

describe("statusesForBuild: names and links", () => {
  it("uses the channel prefix, so two projects in one repo stay apart", () => {
    expect(contexts("storyshelf-web")).toEqual([
      "storyshelf-web/testing",
      "storyshelf-web/storybook",
    ]);
    expect(contexts("storyshelf-docs")).toEqual([
      "storyshelf-docs/testing",
      "storyshelf-docs/storybook",
    ]);
  });

  it("falls back to relative links without a base URL", () => {
    expect(run({ base: "" }).statuses[0]?.url).toBe("/projects/web/builds/b1");
  });
});

describe("statusesForBuild: nothing to show", () => {
  it("returns nothing without a commit", () => {
    expect(run({ build: { gitSha: "" } })).toEqual({ statuses: [], comment: null });
  });

  it("returns nothing for a synthetic local identity", () => {
    expect(run({ build: { gitSha: "local-a1b2c3d4e5f6" } })).toEqual({
      statuses: [],
      comment: null,
    });
  });
});

describe("statusesForBuild: the comment", () => {
  it("is keyed by the build page and carries state, summary and Storybook link", () => {
    const { comment } = run({ build: { status: "reviewing" } });
    expect(comment).toMatchObject({
      url: "https://shelf.example.com/projects/web/builds/b1",
      state: "pending",
    });
    expect(comment?.markdown).toContain(
      "[View build](https://shelf.example.com/projects/web/builds/b1)",
    );
    expect(comment?.markdown).toContain("Visual tests: Review open: 3 changes to review");
    expect(comment?.markdown).toContain("Snapshots: 10 total, 4 changed, 1 approved, 0 rejected");
    expect(comment?.markdown).toContain("storybook/build/b1/");
  });

  it("leaves out the Storybook link until published, and the summary without testing or review", () => {
    const { comment } = run({ publishing: "pending", flags: { testing: false, review: false } });
    expect(comment?.markdown).not.toContain("Storybook:");
    expect(comment?.markdown).not.toContain("Snapshots:");
  });
});

describe("statusesForBuild without a public origin", () => {
  it("drops every link and the comment", () => {
    const set = statusesForBuild({
      build: build(),
      projectSlug: "web",
      prefix: "storyshelf",
      urls: null,
      flags: { testing: true, review: false },
      publishing: "success",
    });
    expect(set.statuses.map((status) => status.url)).toEqual([undefined, undefined]);
    expect(set.statuses.map((status) => status.state)).toEqual(["pending", "success"]);
    expect(set.comment).toBeNull();
  });
});
