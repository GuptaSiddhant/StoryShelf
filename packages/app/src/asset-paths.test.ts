import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findAsset } from "./asset-paths.ts";

const at = (path: string) => (candidate: string) => candidate === path;

describe("findAsset", () => {
  it("finds assets next to the module (source and library build)", () => {
    expect(
      findAsset("x.js", "file:///app/dist/asset-manifest.mjs", at("/app/dist/assets/x.js")),
    ).toBe("/app/dist/assets/x.js");
  });

  it("finds assets one level up (bundled Fly server: dist/server.mjs, /app/assets)", () => {
    expect(findAsset("x.js", "file:///app/dist/server.mjs", at("/app/assets/x.js"))).toBe(
      "/app/assets/x.js",
    );
  });

  it("prefers the nearest location when both exist", () => {
    expect(findAsset("x.js", "file:///app/dist/server.mjs", () => true)).toBe(
      "/app/dist/assets/x.js",
    );
  });

  it("fails fast naming every path it tried", () => {
    expect(() => findAsset("x.js", "file:///app/dist/server.mjs", () => false)).toThrow(
      /"x\.js" not found\. Looked in: \/app\/dist\/assets\/x\.js, \/app\/assets\/x\.js/u,
    );
  });

  it("resolves the real vendored htmx bundle from the source tree", () => {
    expect(findAsset("htmx.min.js", new URL("./asset-manifest.ts", import.meta.url))).toMatch(
      /assets\/htmx\.min\.js$/u,
    );
  });

  it("matches where the Fly Dockerfile copies the bundle's htmx (a missing file crashes boot)", () => {
    const dockerfile = readFileSync(
      new URL("../../../apps/fly-app/Dockerfile", import.meta.url),
      "utf8",
    );
    // Bundled server is /app/dist/server.mjs, so findAsset looks in /app/assets.
    expect(dockerfile).toContain("packages/app/src/assets/htmx.min.js ./assets/htmx.min.js");
    expect(dockerfile).toContain('CMD ["node", "dist/server.mjs"]');
  });
});
