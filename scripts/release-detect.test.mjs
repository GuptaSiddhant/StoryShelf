import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { chooseChannel, findReleaseCommit, nextShaOf } from "./release-detect.mjs";

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
});

describe("chooseChannel for next", () => {
  it("never publishes next on a push, even with changesets pending", () => {
    assert.deepEqual(chooseChannel({ ...push, pending: 1 }), { channel: "none" });
  });

  it("publishes next from the daily run when a package changed since the last next build", () => {
    const daily = { ...push, event: "schedule", pending: 1, changedSinceNext: true };
    assert.deepEqual(chooseChannel(daily), { channel: "next" });
  });

  it("skips the daily next build when nothing changed or nothing is pending", () => {
    const daily = { ...push, event: "schedule", pending: 1, changedSinceNext: false };
    assert.deepEqual(chooseChannel(daily), { channel: "none" });
    assert.deepEqual(chooseChannel({ ...daily, pending: 0, changedSinceNext: true }), {
      channel: "none",
    });
  });

  it("still publishes a merged stable release from the daily run", () => {
    const daily = { ...push, event: "schedule", tagExists: false, pending: 1 };
    assert.deepEqual(chooseChannel(daily), { channel: "stable" });
  });

  it("publishes next on demand while changesets are pending, changed or not", () => {
    const manual = { ...push, event: "workflow_dispatch", requestedChannel: "next", pending: 1 };
    assert.deepEqual(chooseChannel(manual), { channel: "next" });
    const result = chooseChannel({ ...manual, pending: 0 });
    assert.match(result.error, /no changeset is pending/u);
  });

  it("publishes nothing for a push with no pending changeset and a tagged version", () => {
    assert.deepEqual(chooseChannel(push), { channel: "none" });
  });

  it("never treats a prerelease version as a stable release", () => {
    assert.deepEqual(chooseChannel({ ...push, version: "0.9.0-rc.1", tagExists: false }), {
      channel: "none",
    });
  });
});

describe("chooseChannel for a stable re-run", () => {
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

describe("nextShaOf", () => {
  it("reads the commit from a next version", () => {
    assert.equal(nextShaOf("0.10.0-next-abc1234\n"), "abc1234");
  });

  it("is undefined for a stable version or nothing", () => {
    assert.equal(nextShaOf("0.9.0"), undefined);
    assert.equal(nextShaOf(""), undefined);
  });
});

function repo(subjects) {
  const dir = mkdtempSync(join(tmpdir(), "release-detect-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@x", ...args], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
  git("init", "-q");
  const shas = subjects.map((subject, index) => {
    writeFileSync(join(dir, "f"), String(index));
    git("add", "f");
    git("commit", "-q", "--no-verify", "-m", subject);
    return git("rev-parse", "HEAD");
  });
  return { dir, shas };
}

describe("findReleaseCommit", () => {
  it("finds the merged release commit even after later pushes to main", () => {
    const { dir, shas } = repo(["feat: a", "chore(release): v0.9.0 (#500)", "docs: later"]);
    try {
      assert.equal(findReleaseCommit("0.9.0", dir), shas[1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not mistake another version for it, and fails closed when none matches", () => {
    const { dir, shas } = repo(["chore(release): v0.9.0", "chore(release): v0.9.01", "fix: x"]);
    try {
      assert.equal(findReleaseCommit("0.9.0", dir), shas[0]);
      assert.throws(
        () => findReleaseCommit("1.0.0", dir),
        /no "chore\(release\): v1\.0\.0" commit/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
