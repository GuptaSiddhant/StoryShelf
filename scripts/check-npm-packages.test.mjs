import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkPackages,
  existsOnNpm,
  firstPublishHelp,
  hasTrustedPublisher,
} from "./check-npm-packages.mjs";

const registry = (known) => async (url) => {
  const name = decodeURIComponent(url.slice("https://registry.npmjs.org/".length));
  if (name === "boom") return { ok: false, status: 500 };
  return known.includes(name) ? { ok: true, status: 200 } : { ok: false, status: 404 };
};

describe("check-npm-packages", () => {
  it("reads a 404 as a package that is not on npm, and fails on other errors", async () => {
    assert.equal(await existsOnNpm("@storyshelf/core", registry(["@storyshelf/core"])), true);
    assert.equal(await existsOnNpm("@storyshelf/new", registry([])), false);
    await assert.rejects(existsOnNpm("boom", registry([])), /HTTP 500/u);
  });

  it("lists the missing packages and the untrusted ones", async () => {
    const trustFn = (name) =>
      name === "a"
        ? '{"repository":"GuptaSiddhant/StoryShelf","file":"release.yml"}'
        : '{"repository":"someone/else","file":"release.yml"}';
    const result = await checkPackages(["a", "b", "c"], {
      trust: true,
      fetchFn: registry(["a", "b"]),
      trustFn,
    });
    assert.deepEqual(result, { missing: ["c"], untrusted: ["b"] });
  });

  it("skips the trust check unless asked", async () => {
    const result = await checkPackages(["a"], { fetchFn: registry(["a"]), trustFn: () => "" });
    assert.deepEqual(result, { missing: [], untrusted: [] });
  });

  it("matches a trusted publisher only for this repository and workflow", () => {
    assert.equal(hasTrustedPublisher("not json {x}"), false);
    assert.equal(
      hasTrustedPublisher('{"repository":"GuptaSiddhant/StoryShelf","file":"ci.yml"}'),
      false,
    );
  });

  it("names the package and the first-publish steps", () => {
    const help = firstPublishHelp(["@storyshelf/new"]);
    assert.match(help, /@storyshelf\/new/u);
    assert.match(help, /npm-trust-all\.mjs/u);
  });
});
