import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { releaseDue } from "./release-due.mjs";

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
