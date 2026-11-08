/** The package runner of the environment: install and start commands, and how the runner is detected. */
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Package runners with distinct script-invocation syntax. */
export type PackageRunner = "npm" | "pnpm" | "yarn" | "bun" | "nub";

/** Install/start commands per runner (host-side instructions and scaffolds). */
const RUNNER_COMMANDS: Record<PackageRunner, { install: string; start: string }> = {
  npm: { install: "npm install", start: "npm start" },
  pnpm: { install: "pnpm install", start: "pnpm start" },
  yarn: { install: "yarn install", start: "yarn start" },
  bun: { install: "bun install", start: "bun run start" },
  nub: { install: "nub install", start: "nub run start" },
};

/** Install command for a runner (e.g. `pnpm install`). */
export function installCommand(runner: PackageRunner): string {
  return RUNNER_COMMANDS[runner].install;
}

/** Start command for a runner (e.g. `pnpm start`). */
export function startCommand(runner: PackageRunner): string {
  return RUNNER_COMMANDS[runner].start;
}

const KNOWN_RUNNERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun", "nub"]);

/** Normalize a runner name from a `a/b` value (`npm_config_user_agent`, `packageManager` field). */
function asRunner(value: string | undefined): PackageRunner | undefined {
  const name = value?.split(/[/@]/u)[0]?.trim().toLowerCase();
  return name !== undefined && KNOWN_RUNNERS.has(name) ? (name as PackageRunner) : undefined;
}

/** Lockfiles evidencing a package runner, in check order. */
const RUNNER_LOCKFILES: { file: string; runner: PackageRunner }[] = [
  { file: "nub.lock", runner: "nub" },
  { file: "bun.lockb", runner: "bun" },
  { file: "bun.lock", runner: "bun" },
  { file: "pnpm-lock.yaml", runner: "pnpm" },
  { file: "yarn.lock", runner: "yarn" },
  { file: "package-lock.json", runner: "npm" },
];

async function readPackageManagerField(cwd: string): Promise<unknown> {
  try {
    const raw = await readFile(resolve(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { packageManager?: unknown };
    return parsed.packageManager;
  } catch {
    return undefined;
  }
}

/**
 * Detect the project's package runner: invoking agent env, then the
 * `packageManager` field, then lockfiles, defaulting to npm.
 */
export async function detectPackageRunner(cwd: string = process.cwd()): Promise<PackageRunner> {
  const fromAgent = asRunner(process.env["npm_config_user_agent"]);
  if (fromAgent) {
    return fromAgent;
  }
  const field = await readPackageManagerField(cwd);
  const declared = typeof field === "string" ? asRunner(field) : undefined;
  if (declared) {
    return declared;
  }
  return (await runnerFromLockfiles(cwd)) ?? "npm";
}

/** First runner evidenced by a lockfile, or undefined when none match. */
async function runnerFromLockfiles(cwd: string): Promise<PackageRunner | undefined> {
  for (const { file, runner } of RUNNER_LOCKFILES) {
    try {
      // eslint-disable-next-line no-await-in-loop -- probe candidates in order, return first hit
      await access(resolve(cwd, file));
      return runner;
    } catch {
      continue;
    }
  }
  return undefined;
}
