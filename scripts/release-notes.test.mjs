import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { installSection, publishedPackages, releaseNotes } from "./release-notes.mjs";

function workspace(manifests) {
  const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
  for (const [folder, manifest] of Object.entries(manifests)) {
    mkdirSync(join(dir, folder));
    writeFileSync(join(dir, folder, "package.json"), JSON.stringify(manifest));
  }
  mkdirSync(join(dir, "not-a-package"));
  return dir;
}

describe("publishedPackages", () => {
  it("lists public packages, the CLI and the app first, and leaves out private ones", () => {
    const dir = workspace({
      core: { name: "@storyshelf/core" },
      app: { name: "@storyshelf/app" },
      cli: { name: "storyshelf" },
      hidden: { name: "@storyshelf/hidden", private: true },
      auth: { name: "@storyshelf/auth" },
    });
    try {
      assert.deepEqual(
        publishedPackages(dir).map((pkg) => pkg.name),
        ["storyshelf", "@storyshelf/app", "@storyshelf/auth", "@storyshelf/core"],
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("installSection", () => {
  const packages = [{ name: "storyshelf" }, { name: "@storyshelf/app" }];

  it("links the packages and the GHCR images, with a pull line each", () => {
    const text = installSection("v0.14.0", { packages });
    assert.match(
      text,
      /\[`storyshelf@0\.14\.0`\]\(https:\/\/www\.npmjs\.com\/package\/storyshelf\/v\/0\.14\.0\)/u,
    );
    assert.match(text, /\/package\/@storyshelf\/app\/v\/0\.14\.0\)/u);
    assert.match(
      text,
      /storyshelf:0\.14\.0-hosting`\]\(https:\/\/github\.com\/GuptaSiddhant\/StoryShelf\/pkgs\/container\/storyshelf\)/u,
    );
    assert.match(text, /^docker pull ghcr\.io\/guptasiddhant\/storyshelf:0\.14\.0$/mu);
    assert.match(text, /^docker pull ghcr\.io\/guptasiddhant\/storyshelf:0\.14\.0-hosting$/mu);
    assert.doesNotMatch(text, /docker\.io|hub\.docker\.com/u);
  });

  it("adds the Docker Hub tags only when they were pushed", () => {
    const text = installSection("v0.14.0", { packages, dockerhub: true });
    assert.match(text, /^docker pull guptasiddhant\/storyshelf:0\.14\.0$/mu);
    assert.match(text, /^docker pull guptasiddhant\/storyshelf:0\.14\.0-hosting$/mu);
  });
});

describe("releaseNotes", () => {
  const changelog = "# Changelog\n\n## 0.14.0 - 2026-11-20\n\n### Added\n\n- Added: a thing\n";

  it("appends the Install section after the changelog links", () => {
    const text = releaseNotes(changelog, "v0.14.0", { packages: [{ name: "storyshelf" }] });
    assert.ok(text.indexOf("**Details:**") < text.indexOf("## Install"));
  });

  it("is unchanged without install options, and null for an unknown tag", () => {
    assert.doesNotMatch(releaseNotes(changelog, "v0.14.0"), /## Install/u);
    assert.equal(releaseNotes(changelog, "v9.9.9"), null);
  });
});
