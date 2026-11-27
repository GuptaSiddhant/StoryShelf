import type { Command } from "commander";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const zipLibraryLoaded = vi.hoisted(() => vi.fn());
vi.mock("archiver", () => {
  zipLibraryLoaded();
  return { ZipArchive: vi.fn() };
});

const runUpload = vi.hoisted(() => vi.fn());
vi.mock("./commands/upload.ts", () => ({ runUpload }));

import { cliVersion } from "./config.ts";
import { createProgram } from "./index.ts";

describe("createProgram", () => {
  it("registers every command without loading command modules", () => {
    const program = createProgram();
    expect(program.commands.map((command) => command.name()).toSorted()).toEqual([
      "build",
      "cancel",
      "create",
      "default",
      "doctor",
      "init",
      "protect",
      "retry",
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

/** The flags a command declares, sorted. */
function flagsOf(command?: Command): string[] {
  return (command?.options ?? []).map((option) => option.flags).toSorted();
}

/** Make every command throw instead of exiting, and keep commander's own output quiet. */
function quiet(program: Command, written: string[]): Command {
  const configure = (command: Command): void => {
    command.exitOverride();
    command.configureOutput({
      writeOut: (text) => written.push(text),
      writeErr: (text) => written.push(text),
    });
  };
  configure(program);
  for (const command of program.commands) {
    configure(command);
  }
  return program;
}

describe("bare storyshelf takes upload's options", () => {
  let dir: string;
  let written: string[];
  let err: string;
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "storyshelf-index-"));
    written = [];
    err = "";
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    runUpload.mockReset();
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(): string {
    const config = join(dir, "storyshelf.json");
    writeFileSync(config, JSON.stringify({ slug: "demo", url: "https://shelf.example.com" }));
    mkdirSync(join(dir, "storybook-static"), { recursive: true });
    return config;
  }

  function parse(...args: string[]): Promise<Command> {
    return quiet(createProgram(), written).parseAsync(["node", "storyshelf", ...args]);
  }

  it("passes --wait, --branch and --sha to upload, as `storyshelf upload` does", async () => {
    const config = writeConfig();
    const flags = ["--wait", "--branch", "feature/x", "--sha", "abc123", "-c", config];
    await parse(...flags);
    await parse("upload", ...flags);
    expect(runUpload).toHaveBeenCalledTimes(2);
    const [bare, explicit] = runUpload.mock.calls.map(([options]) => options);
    expect(bare).toMatchObject({ wait: true, branch: "feature/x", sha: "abc123" });
    expect(bare).toEqual(explicit);
  });

  it("accepts every option `upload` declares", () => {
    const program = createProgram();
    const upload = program.commands.find((command) => command.name() === "upload");
    const bare = program.commands.find((command) => command.name() === "default");
    expect(flagsOf(bare)).toEqual(flagsOf(upload));
    expect(flagsOf(bare)).toContain("--wait");
  });

  it("uploads on a bare invocation when a config exists", async () => {
    await parse("--dry-run", "-c", writeConfig());
    expect(runUpload).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it("lists the commands in --help and hides the default one", async () => {
    await expect(parse("--help")).rejects.toMatchObject({ code: "commander.helpDisplayed" });
    const help = written.join("");
    for (const name of ["init", "upload", "doctor", "whoami", "retry"]) {
      expect(help).toContain(name);
    }
    expect(help).not.toContain("default");
    expect(runUpload).not.toHaveBeenCalled();
  });

  it("still errors on an unknown flag, without uploading", async () => {
    writeConfig();
    await expect(parse("--no-such-flag")).rejects.toMatchObject({
      code: "commander.unknownOption",
    });
    expect(runUpload).not.toHaveBeenCalled();
  });

  it("still errors on an unknown subcommand, without uploading", async () => {
    writeConfig();
    await expect(parse("nope")).rejects.toMatchObject({ exitCode: 1 });
    expect(runUpload).not.toHaveBeenCalled();
  });

  it("points at init when there is no config, even with options", async () => {
    await parse("--wait", "--branch", "main", "-c", join(dir, "missing.json"));
    expect(err).toContain("storyshelf init");
    expect(process.exitCode).toBe(1);
    expect(runUpload).not.toHaveBeenCalled();
  });
});
