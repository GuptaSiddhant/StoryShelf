import { spawn } from "node:child_process";
import { installCommand, type PackageRunner } from "./runner.ts";

/**
 * Run the runner's install in `cwd`, with its output shown. Resolves with the exit code (1 when the
 * runner is not on `PATH`). Only `--install` calls it: nothing installs unless asked.
 */
export async function runInstall(cwd: string, runner: PackageRunner): Promise<number> {
  const [command = runner, ...args] = installCommand(runner).split(" ");
  return await new Promise<number>((done) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", () => {
      done(1);
    });
    child.once("exit", (code) => {
      done(code ?? 1);
    });
  });
}
