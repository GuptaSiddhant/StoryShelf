import { describe, expect, it } from "vitest";
import { instanceDir, recordingIo } from "./__fixtures__/instance-dir.ts";
import { SERVER_HELP } from "./help.ts";
import { runServerBin } from "./main.ts";

describe("runServerBin", () => {
  it("prints help with no command, loading no instance", async () => {
    const io = recordingIo();
    expect(await runServerBin([], io)).toBe(0);
    expect(io.stdout).toEqual([SERVER_HELP]);
  });

  it("prints the version", async () => {
    const io = recordingIo();
    expect(await runServerBin(["--version"], io)).toBe(0);
    expect(io.stdout[0]).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it("exits 2 on an argument error without loading anything", async () => {
    const io = recordingIo();
    expect(await runServerBin(["bogus"], io)).toBe(2);
    expect(io.stderr[0]).toContain('unknown command "bogus"');
  });

  it("exits 1 with the reason when a command fails", async () => {
    const io = recordingIo();
    expect(await runServerBin(["migrate", "--dir", "/nonexistent-dir"], io)).toBe(1);
    expect(io.stderr[0]).toContain("No instance module");
  });

  it("refuses a renamed variable before loading the instance", async () => {
    const io = recordingIo();
    const code = await runServerBin(["migrate", "--dir", instanceDir()], io, { ADMIN_TOKEN: "x" });
    expect(code).toBe(1);
    expect(io.stderr[0]).toContain("SHELF_ADMIN_TOKEN");
  });

  it("migrates, then reports done", async () => {
    const io = recordingIo();
    expect(await runServerBin(["migrate", "--dir", instanceDir()], io)).toBe(0);
    expect(io.stdout[0]).toContain("Migrations");
  });
});
