import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInstall } from "./install.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "create-storyshelf-install-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runInstall", () => {
  it("answers 1 when the package manager is not on PATH", async () => {
    const path = process.env["PATH"];
    process.env["PATH"] = dir;
    try {
      expect(await runInstall(dir, "nub")).toBe(1);
    } finally {
      process.env["PATH"] = path;
    }
  });
});
