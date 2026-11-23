import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refreshOutcome, releaseDue, releasePlan } from "./release-due.mjs";

const now = new Date("2026-11-09T06:00:00Z");
const base = { pending: 3, openReleasePrs: 0, lastMinor: new Date("2026-11-08T00:00:00Z"), now };
const merged = {
  ...base,
  event: "pull_request_target",
  merged: true,
  labels: [],
  headRef: "fix/x",
};

describe("releaseDue", () => {
  it("releases after a merged P0 pull request", () => {
    assert.equal(releaseDue({ ...merged, labels: ["p0-critical", "bug"] }).due, true);
  });

  it("releases after a merged epic branch", () => {
    const verdict = releaseDue({ ...merged, headRef: "epic/804-calmer-app" });
    assert.deepEqual(verdict, { due: true, reason: "epic epic/804-calmer-app was merged" });
  });

  it("does not release for an ordinary merge, or a P0 closed without merging", () => {
    assert.equal(releaseDue(merged).due, false);
    assert.equal(releaseDue({ ...merged, merged: false, labels: ["p0-critical"] }).due, false);
  });

  it("releases from the daily check once the last minor is 7 days old, not before", () => {
    const schedule = { ...base, event: "schedule" };
    assert.equal(
      releaseDue({ ...schedule, lastMinor: new Date("2026-11-02T06:00:00Z") }).due,
      true,
    );
    assert.equal(
      releaseDue({ ...schedule, lastMinor: new Date("2026-11-03T06:00:01Z") }).due,
      false,
    );
    assert.equal(releaseDue({ ...schedule, lastMinor: null }).due, true);
  });

  it("never releases without pending changesets or while a release pull request is open", () => {
    const p0 = { ...merged, labels: ["p0-critical"] };
    assert.deepEqual(releaseDue({ ...p0, pending: 0 }), {
      due: false,
      reason: "no pending changesets",
    });
    assert.equal(releaseDue({ ...p0, openReleasePrs: 1 }).due, false);
    assert.equal(releaseDue({ ...base, event: "workflow_dispatch", openReleasePrs: 1 }).due, false);
  });

  it("releases on a manual request when changesets are pending", () => {
    assert.equal(releaseDue({ ...base, event: "workflow_dispatch" }).due, true);
  });
});

describe("releasePlan", () => {
  const p0 = { ...merged, labels: ["p0-critical"] };

  it("opens a release when none is open and one is due", () => {
    assert.equal(releasePlan(p0).action, "open");
  });

  it("refreshes the one open release when main has changesets it does not consume", () => {
    const plan = releasePlan({ ...base, event: "schedule", openReleasePrs: 1, unconsumed: 2 });
    assert.equal(plan.action, "refresh");
  });

  it("refreshes on any trigger, even an ordinary merge", () => {
    assert.equal(releasePlan({ ...merged, openReleasePrs: 1, unconsumed: 1 }).action, "refresh");
  });

  it("refreshes the open release by hand even when it consumes every changeset", () => {
    const plan = releasePlan({
      ...base,
      event: "workflow_dispatch",
      openReleasePrs: 1,
      unconsumed: 0,
    });
    assert.equal(plan.action, "refresh");
  });

  it("does nothing when the open release already consumes every changeset", () => {
    const plan = releasePlan({ ...base, event: "schedule", openReleasePrs: 1, unconsumed: 0 });
    assert.deepEqual(plan, {
      action: "none",
      due: false,
      reason: "the open release pull request is current",
    });
  });

  it("does nothing without pending changesets, or when two releases are open", () => {
    assert.equal(releasePlan({ ...base, event: "schedule", pending: 0 }).action, "none");
    assert.equal(
      releasePlan({ ...base, event: "schedule", openReleasePrs: 2, unconsumed: 1 }).action,
      "none",
    );
  });

  it("does nothing when a release is not due", () => {
    assert.equal(releasePlan(merged).action, "none");
  });
});

describe("refreshOutcome", () => {
  it("updates the branch when the version is unchanged", () => {
    assert.equal(refreshOutcome("v0.13.1", "0.13.1"), "update");
  });

  it("replaces the pull request when the bump changed", () => {
    assert.equal(refreshOutcome("v0.13.1", "0.14.0"), "replace");
  });
});
