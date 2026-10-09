import { describe, expect, it, vi } from "vitest";

const zipLibraryLoaded = vi.hoisted(() => vi.fn());
vi.mock("archiver", () => {
  zipLibraryLoaded();
  return { ZipArchive: vi.fn() };
});

import { cliVersion } from "./config.ts";
import { createProgram } from "./index.ts";

describe("createProgram", () => {
  it("registers every command without loading command modules", () => {
    const program = createProgram();
    expect(program.commands.map((command) => command.name()).toSorted()).toEqual([
      "build",
      "create",
      "doctor",
      "init",
      "mcp",
      "purge",
      "retry",
      "server",
      "upload",
      "whoami",
      "worker",
    ]);
    expect(zipLibraryLoaded).not.toHaveBeenCalled();
  });

  it("reports the build-time package version, not a hardcoded one", () => {
    expect(createProgram().version()).toBe(cliVersion() ?? "0.0.0-dev");
    expect(createProgram().version()).not.toBe("0.2.0");
  });
});
