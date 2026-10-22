import { describe, expect, it } from "vitest";
import { createUrlBuilder } from "../../urls.ts";
import {
  MAX_ANNOTATIONS,
  statusesForBuild,
  type BuildStateBuild,
  type BuildStateChange,
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
    approvals?: { given: number; required: number };
    changes?: BuildStateChange[];
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
    approvals: overrides.approvals,
    changes: overrides.changes,
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
    ["cancelled", "cancelled", "Cancelled"],
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
    expect(gate(run({ flags, build: { status: "cancelled" } }))).toMatchObject({
      name: "review",
      state: "cancelled",
      description: "Cancelled",
    });
  });

  it("closes the pull request comment on a cancelled build, saying so", () => {
    for (const flags of [
      { testing: true, review: false },
      { testing: false, review: true },
    ]) {
      const set = run({ flags, build: { status: "cancelled" } });
      expect(set.comment?.state).toBe("cancelled");
      expect(set.comment?.markdown).toContain("Cancelled");
      expect(set.comment?.markdown).not.toContain("failed");
    }
  });

  it("shows approval progress while a build waits for several approvals", () => {
    const flags = { testing: false, review: true };
    const waiting = (given: number, required: number) =>
      gate(run({ flags, build: { status: "pending" }, approvals: { given, required } }));
    expect(waiting(1, 2)).toMatchObject({
      state: "pending",
      description: "Waiting for approvals: 1 of 2",
    });
    expect(waiting(0, 3)?.description).toBe("Waiting for approvals: 0 of 3");
    expect(waiting(0, 1)?.description).toBe("Waiting for a review verdict");
    expect(gate(run({ flags, build: { status: "pending" } }))?.description).toBe(
      "Waiting for a review verdict",
    );
  });

  it("closes the review status with a success once review is off and the build is accepted", () => {
    const flags = { testing: false, review: false };
    const set = run({ flags, build: { status: "approved" } });
    expect(set.statuses.map((status) => status.context)).toEqual([
      "storyshelf/review",
      "storyshelf/storybook",
    ]);
    expect(gate(set)).toMatchObject({
      state: "success",
      description: "Review is off",
      url: "https://shelf.example.com/projects/web/builds/b1",
    });
    expect(set.comment?.state).toBe("success");
  });

  it("shows no review status with review off for a build that is not accepted", () => {
    const flags = { testing: false, review: false };
    for (const status of ["pending", "failed", "cancelled", "rejected"]) {
      expect(run({ flags, build: { status } }).statuses.map((entry) => entry.name)).toEqual([
        "storybook",
      ]);
    }
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

const change = (n: number, overrides: Partial<BuildStateChange> = {}): BuildStateChange => ({
  id: `S${String(n)}`,
  status: "changed",
  storyTitle: "Button",
  storyName: `Story ${String(n)}`,
  storyImportPath: "./src/Button.stories.tsx",
  viewportName: "desktop",
  browser: "chromium",
  ...overrides,
});

describe("statusesForBuild: progress and annotations", () => {
  it("is queued before capture and running after", () => {
    expect(gate(run({ build: { status: "pending" } }))?.progress).toBe("queued");
    expect(gate(run({ build: { status: "capturing" } }))?.progress).toBe("running");
    expect(gate(run({ build: { status: "reviewing" } }))?.progress).toBe("running");
    expect(gate(run({ build: { status: "approved" } }))?.progress).toBeUndefined();
  });

  it("annotates every changed or new snapshot with its review link", () => {
    const set = run({
      build: { status: "reviewing" },
      changes: [
        change(1),
        change(2, { status: "new", storyImportPath: null, browser: undefined }),
        change(3, { status: "approved" }),
        change(4, { status: "unchanged" }),
      ],
    });
    expect(gate(set)?.annotations).toEqual([
      {
        path: "src/Button.stories.tsx",
        title: "Button / Story 1 (desktop, chromium)",
        message:
          "Visual change: review it at https://shelf.example.com/projects/web/builds/b1/diff?snapshot=S1",
        url: "https://shelf.example.com/projects/web/builds/b1/diff?snapshot=S1",
        level: "warning",
      },
      {
        path: ".storybook",
        title: "Button / Story 2 (desktop)",
        message:
          "New snapshot: review it at https://shelf.example.com/projects/web/builds/b1/diff?snapshot=S2",
        url: "https://shelf.example.com/projects/web/builds/b1/diff?snapshot=S2",
        level: "notice",
      },
    ]);
    expect(gate(set)?.omitted).toBeUndefined();
  });

  it("caps the annotations and counts the rest", () => {
    const changes = Array.from({ length: MAX_ANNOTATIONS + 7 }, (_, i) => change(i));
    const status = gate(run({ build: { status: "reviewing" }, changes }));
    expect(status?.annotations).toHaveLength(MAX_ANNOTATIONS);
    expect(status?.omitted).toBe(7);
  });

  it("annotates only the testing gate, never the storybook status or the review gate", () => {
    const withTesting = run({ changes: [change(1)] });
    expect(withTesting.statuses.find((s) => s.name === "storybook")?.annotations).toBeUndefined();
    const review = run({ flags: { testing: false, review: true }, changes: [change(1)] });
    expect(gate(review)?.annotations).toBeUndefined();
  });
});
