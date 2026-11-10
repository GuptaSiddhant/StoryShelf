import { describe, expect, it, vi } from "vite-plus/test";

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
      "protect",
      "purge",
      "retry",
      "server",
      "upload",
      "whoami",
    ]);
    expect(zipLibraryLoaded).not.toHaveBeenCalled();
  });

  it("reports the build-time package version, not a hardcoded one", () => {
    expect(createProgram().version()).toBe(cliVersion() ?? "0.0.0-dev");
    expect(createProgram().version()).not.toBe("0.2.0");
  });

  it.each(["upload", "build"])(
    "leaves buildStats unset on `%s` unless the flag is given, so the config file decides",
    (name) => {
      const command = createProgram().commands.find((candidate) => candidate.name() === name);
      expect(command).toBeDefined();
      command?.parseOptions([]);
      expect(command?.opts()["buildStats"]).toBeUndefined();
      command?.parseOptions(["--no-build-stats"]);
      expect(command?.opts()["buildStats"]).toBe(false);
      command?.parseOptions(["--build-stats"]);
      expect(command?.opts()["buildStats"]).toBe(true);
    },
  );
});
