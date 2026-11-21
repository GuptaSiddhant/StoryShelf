import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAboveAll, expectedOn, SYNTHETIC_VERSION } from "./expectation.ts";

// 0.13.0 declared v1 everywhere; 0.14.0 reads notify jobs at v2 (a repository link's).
const v13 = { capture: 1, publish: 1, notify: 1, "review-request": 1 };
const v14 = { ...v13, notify: 2 };

describe("expectedOn", () => {
  it("a previous release that declares less hands back a v2 notify job (as 0.13 did)", () => {
    assert.equal(expectedOn(v13, { kind: "notify", v: 2 }), "hand-back");
    assert.equal(expectedOn(v13, { kind: "notify", v: 1 }), "run");
    assert.equal(expectedOn(v13, { kind: "capture", v: 1 }), "run");
  });
  it("a previous release that declares the same runs a v2 notify job (as 0.14 does)", () => {
    assert.equal(expectedOn(v14, { kind: "notify", v: 2 }), "run");
    assert.equal(expectedOn(v14, { kind: "publish", v: 2 }), "hand-back");
  });
  it("hands back the synthetic job on both, and refuses an unknown kind", () => {
    for (const declared of [v13, v14])
      for (const kind of Object.keys(declared))
        assert.equal(expectedOn(declared, { kind, v: SYNTHETIC_VERSION }), "hand-back");
    assert.throws(() => expectedOn(v14, { kind: "other", v: 1 }), /no handler for other/u);
  });
});

describe("assertAboveAll", () => {
  it("passes while the synthetic version is above every declared one", () => {
    assert.doesNotThrow(() => assertAboveAll(v13, v14));
  });
  it("fails when a release declares it", () => {
    assert.throws(() => assertAboveAll({ notify: SYNTHETIC_VERSION }), /raise SYNTHETIC_VERSION/u);
  });
});
