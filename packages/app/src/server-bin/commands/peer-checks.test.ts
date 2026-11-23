import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findInstalled, peerChecks } from "./peer-checks.ts";

type Json = Record<string, unknown>;

/** Write `node_modules/<name>/package.json` under `root`. */
function install(root: string, name: string, manifest: Json): string {
  const dir = join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, ...manifest }));
  return dir;
}

/** A project that names `@storyshelf/db` and installs it with core, at `version`. */
function project(version = "0.14.0", peers: Json = {}, meta: Json = {}): string {
  const root = mkdtempSync(join(tmpdir(), "storyshelf-peers-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { "@storyshelf/db": version, "@storyshelf/core": version } }),
  );
  install(root, "@storyshelf/core", { version });
  install(root, "@storyshelf/db", {
    version,
    peerDependencies: { "@storyshelf/core": version, ...peers },
    peerDependenciesMeta: meta,
  });
  return root;
}

const text = (checks: { status: string; message: string }[]): string =>
  checks.map(({ status, message }) => `${status}: ${message}`).join("\n");

describe("peerChecks", () => {
  it("passes one version, one core and an installed required peer", () => {
    const checks = peerChecks(project());
    expect(checks.map(({ status }) => status)).toEqual(["pass", "pass", "pass"]);
    expect(text(checks)).toContain("peer @storyshelf/core 0.14.0 is installed");
  });

  it("has nothing to check without a package.json or any @storyshelf package", () => {
    expect(peerChecks(mkdtempSync(join(tmpdir(), "storyshelf-peers-")))).toEqual([]);
  });

  it("fails a declared @storyshelf package that is not installed", () => {
    const root = mkdtempSync(join(tmpdir(), "storyshelf-peers-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/storage": "0.14.0" } }),
    );
    expect(text(peerChecks(root))).toContain(
      "fail: @storyshelf/storage is declared in package.json but not installed",
    );
  });

  it("fails mixed @storyshelf versions", () => {
    const root = project("0.14.0");
    install(root, "@storyshelf/db", { version: "0.13.0", peerDependencies: {} });
    expect(text(peerChecks(root))).toMatch(
      /fail: Mixed @storyshelf\/\* versions: .*0\.13\.0 \(@storyshelf\/db\)/u,
    );
  });

  it("fails a second copy of core under an adapter", () => {
    const root = project();
    install(join(root, "node_modules/@storyshelf/db"), "@storyshelf/core", { version: "0.14.0" });
    expect(text(peerChecks(root))).toContain("fail: More than one copy of @storyshelf/core");
  });

  it("fails a required peer that is missing, with the install line", () => {
    const checks = peerChecks(project("0.14.0", { pg: "^8.0.0" }));
    expect(text(checks)).toContain(
      'fail: @storyshelf/db: peer pg is missing. Install it: npm install pg@"^8.0.0"',
    );
  });

  it("is silent about an optional peer that is absent", () => {
    const checks = peerChecks(project("0.14.0", { pg: "^8.0.0" }, { pg: { optional: true } }));
    expect(text(checks)).not.toContain("pg");
  });

  it("reports an installed optional peer in range, and out of range as a failure", () => {
    const root = project("0.14.0", { pg: "^8.0.0" }, { pg: { optional: true } });
    install(root, "pg", { version: "8.2.0" });
    expect(text(peerChecks(root))).toContain("pass: @storyshelf/db: peer pg 8.2.0 is installed");
    install(root, "pg", { version: "9.0.0" });
    expect(text(peerChecks(root))).toContain(
      'fail: @storyshelf/db: peer pg 9.0.0 is out of range (wants ^8.0.0). Install it: npm install pg@"^8.0.0"',
    );
  });

  it("fails an @storyshelf peer at another version, and accepts a workspace range", () => {
    const root = project("0.14.0");
    install(root, "@storyshelf/core", { version: "0.13.0" });
    expect(text(peerChecks(root))).toContain("peer @storyshelf/core 0.13.0 is out of range");
    install(root, "@storyshelf/db", {
      version: "0.14.0",
      peerDependencies: { "@storyshelf/core": "workspace:*" },
    });
    expect(text(peerChecks(root))).toContain("pass: @storyshelf/db: peer @storyshelf/core 0.13.0");
  });
});

describe("findInstalled", () => {
  it("looks in each parent directory, as node does", () => {
    const root = project();
    mkdirSync(join(root, "a/b"), { recursive: true });
    expect(findInstalled("@storyshelf/core", join(root, "a/b"))?.manifest.version).toBe("0.14.0");
    expect(findInstalled("not-installed-anywhere-xyz", join(root, "a/b"))).toBeUndefined();
  });
});
