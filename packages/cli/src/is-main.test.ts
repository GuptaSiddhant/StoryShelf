import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isMainModule } from "./is-main.ts";

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "ss-is-main-"));
  const real = join(dir, "cli.js");
  writeFileSync(real, "");
  const link = join(dir, "storyshelf");
  symlinkSync(real, link);
  return { real, link, url: pathToFileURL(real).href };
}

describe("isMainModule", () => {
  it("matches the real entrypoint path", () => {
    const { real, url } = fixture();
    expect(isMainModule(url, real)).toBe(true);
  });

  it("matches when launched through a .bin-style symlink", () => {
    const { link, url } = fixture();
    expect(isMainModule(url, link)).toBe(true);
  });

  it("rejects a different entrypoint", () => {
    const { url } = fixture();
    const other = join(tmpdir(), "other.js");
    expect(isMainModule(url, other)).toBe(false);
  });

  it("rejects a missing argv[1]", () => {
    expect(isMainModule("file:///x.js")).toBe(false);
  });
});
