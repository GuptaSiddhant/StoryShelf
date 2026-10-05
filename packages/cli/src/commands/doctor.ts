import { gitRepoStatus } from "@storyshelf/affected";
import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "../client.ts";
import { findStorybookMain, loadStorybookConfig, type StorybookConfig } from "../config.ts";
import { printLine } from "../output.ts";
import {
  resolveConnection,
  type ConnectionOptions,
  type ResolvedConnection,
} from "./connection.ts";
import { needsBuild, resolveBuildCommand } from "./storybook-build.ts";

/** Options for the `doctor` command. */
export interface DoctorOptions extends ConnectionOptions {
  /** Built Storybook directory. */
  buildDir?: string;
  /** Build command. */
  buildCommand?: string;
  /** Build script name. */
  buildScriptName?: string;
}

type CheckStatus = "pass" | "warn" | "fail";

interface Check {
  status: CheckStatus;
  message: string;
}

interface BuildInputs {
  buildDir: string;
  buildCommand?: string;
  buildScriptName?: string;
}

function mark(status: CheckStatus): string {
  if (status === "pass") {
    return "✓";
  }
  return status === "warn" ? "!" : "✗";
}

async function checkSetup(cwd: string): Promise<Check> {
  const main = await findStorybookMain(cwd);
  if (!main) {
    return { status: "fail", message: "No .storybook/main.* found" };
  }
  return { status: "pass", message: `Storybook setup found (${main})` };
}

function checkConfigFile(cfg: StorybookConfig | null): Check {
  if (!cfg) {
    return {
      status: "warn",
      message: "No config file — url/slug/token must come from flags or env",
    };
  }
  return { status: "pass", message: `Config loaded (slug "${cfg.slug}")` };
}

function serverErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "cannot reach server — check --url and network";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("(401)")) {
    return "authentication failed (401) — check STORYSHELF_TOKEN";
  }
  if (message.includes("(403)")) {
    return "forbidden (403) — token lacks access to this project";
  }
  if (message.includes("(404)")) {
    return "project not found (404) — check --slug";
  }
  return message;
}

async function checkServer(connection: ResolvedConnection): Promise<Check> {
  try {
    const project = (await createClient(connection.url, connection.token).projects.get(
      connection.slug,
    )) as { name?: unknown };
    const name =
      typeof project.name === "string" && project.name.length > 0 ? project.name : connection.slug;
    return { status: "pass", message: `Server reachable, project "${name}" readable` };
  } catch (error) {
    return { status: "fail", message: `Server check failed: ${serverErrorMessage(error)}` };
  }
}

async function checkBuildOutput(cwd: string, inputs: BuildInputs): Promise<Check> {
  const full = resolve(cwd, inputs.buildDir);
  if (await needsBuild(full)) {
    const command = await resolveBuildCommand(
      cwd,
      inputs.buildDir,
      inputs.buildCommand,
      inputs.buildScriptName,
    );
    return { status: "warn", message: `Build output missing — upload would run: ${command}` };
  }
  try {
    await access(resolve(full, "index.json"));
  } catch {
    return {
      status: "fail",
      message: `Build output incomplete: no index.json in ${inputs.buildDir} (upload would zip it as-is)`,
    };
  }
  const entries = await readdir(full);
  return {
    status: "pass",
    message: `Build output ready: ${inputs.buildDir} (${entries.length} top-level entries)`,
  };
}

function resolveBuildInputs(options: DoctorOptions, cfg: StorybookConfig | null): BuildInputs {
  return {
    buildDir: options.buildDir ?? cfg?.buildDir ?? "storybook-static",
    buildCommand: options.buildCommand ?? cfg?.buildCommand,
    buildScriptName: options.buildScriptName ?? cfg?.buildScriptName,
  };
}

/**
 * Diagnose whether an upload would succeed, without uploading anything.
 * Prints one line per check; sets exit code 1 when any check fails.
 *
 * @param options - Connection and build options (flags, config, or env).
 */
export async function runDoctor(options: DoctorOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const cfg = await loadStorybookConfig(cwd, options.config);
  const checks: Check[] = [await checkSetup(cwd), checkConfigFile(cfg)];
  const connection = await tryResolveConnection(options, checks);
  if (connection) {
    checks.push(await checkServer(connection));
  }
  checks.push(
    await checkBuildOutput(cwd, resolveBuildInputs(options, cfg)),
    await checkAffected(cwd, resolveBuildInputs(options, cfg).buildDir),
  );
  reportChecks(checks);
}

/** Warn when affected capture would silently fall back to a full render. */
async function checkAffected(cwd: string, buildDir: string): Promise<Check> {
  const repo = gitRepoStatus(cwd);
  if (repo === "no-git") {
    return {
      status: "warn",
      message:
        "No git repository — upload uses a synthetic local identity and affected capture renders all stories",
    };
  }
  if (repo === "shallow") {
    return {
      status: "warn",
      message: "Shallow clone detected — affected capture renders all stories (use fetch-depth: 0)",
    };
  }
  try {
    await access(resolve(cwd, buildDir, "preview-stats.json"));
  } catch {
    return {
      status: "warn",
      message: `No preview-stats.json in ${buildDir} — affected capture renders all stories`,
    };
  }
  return { status: "pass", message: "Affected capture ready (history and stats available)" };
}

/** Resolve the connection, recording success or failure as a check. */
async function tryResolveConnection(
  options: DoctorOptions,
  checks: Check[],
): Promise<ResolvedConnection | null> {
  try {
    const connection = await resolveConnection(options);
    checks.push({
      status: "pass",
      message: `Connection: ${connection.url} / ${connection.slug} (token present)`,
    });
    return connection;
  } catch (error) {
    checks.push({
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Print all checks; fail the process when any check failed. */
function reportChecks(checks: Check[]): void {
  for (const check of checks) {
    printLine(`${mark(check.status)} ${check.message}`);
  }
  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}
