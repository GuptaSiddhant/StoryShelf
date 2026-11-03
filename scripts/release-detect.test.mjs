import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseChannel } from "./release-detect.mjs";

const push = { event: "push", version: "0.9.0", tagExists: true, pending: 0 };

describe("chooseChannel", () => {
  it("publishes a stable version that has no tag yet (a release pull request was merged)", () => {
    assert.deepEqual(chooseChannel({ ...push, tagExists: false }), { channel: "stable" });
  });

  it("prefers stable over next when both could apply", () => {
    assert.deepEqual(chooseChannel({ ...push, tagExists: false, pending: 2 }), {
      channel: "stable",
    });
  });

  it("publishes next when changesets are pending and the version is already released", () => {
    assert.deepEqual(chooseChannel({ ...push, pending: 1 }), { channel: "next" });
  });

  it("publishes nothing for a push with no pending changeset and a tagged version", () => {
    assert.deepEqual(chooseChannel(push), { channel: "none" });
  });

  it("never treats a prerelease version as a stable release", () => {
    assert.deepEqual(chooseChannel({ ...push, version: "0.9.0-rc.1", tagExists: false }), {
      channel: "none",
    });
  });

  it("re-runs the stable path for the version on main, tag or not", () => {
    const rerun = { ...push, event: "workflow_dispatch", requested: "0.9.0" };
    assert.deepEqual(chooseChannel(rerun), { channel: "stable" });
    assert.deepEqual(chooseChannel({ ...rerun, tagExists: false }), { channel: "stable" });
  });

  it("refuses a dispatch for a version that is not the one on main", () => {
    const result = chooseChannel({ ...push, event: "workflow_dispatch", requested: "0.8.0" });
    assert.match(result.error, /asked to publish 0\.8\.0, but main is at 0\.9\.0/u);
  });

  it("refuses to publish a prerelease by hand", () => {
    const result = chooseChannel({
      ...push,
      event: "workflow_dispatch",
      version: "0.9.0-rc.1",
      requested: "0.9.0-rc.1",
    });
    assert.match(result.error, /prerelease/u);
  });
});
