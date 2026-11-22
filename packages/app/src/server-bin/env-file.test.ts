import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDotEnv } from "./env-file.ts";

describe("loadDotEnv", () => {
  it("adds the missing variables and leaves the shell's alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-env-"));
    writeFileSync(join(dir, ".env"), "SHELF_A=from-file\nSHELF_B=from-file\n");
    const env: Record<string, string | undefined> = { SHELF_B: "from-shell" };
    expect(await loadDotEnv(dir, env)).toEqual(["SHELF_A"]);
    expect(env).toEqual({ SHELF_A: "from-file", SHELF_B: "from-shell" });
  });

  it("is fine without a .env", async () => {
    expect(await loadDotEnv(mkdtempSync(join(tmpdir(), "storyshelf-env-")), {})).toEqual([]);
  });

  it("rethrows other read errors", async () => {
    await expect(loadDotEnv("/dev/null", {})).rejects.toThrow();
  });
});
