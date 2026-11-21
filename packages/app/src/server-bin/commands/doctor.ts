import { readSetting } from "@storyshelf/core/config";
import type { ServerFlags } from "../args.ts";
import { loadInstance } from "../instance.ts";
import type { Io } from "../io.ts";

type Status = "pass" | "warn" | "fail";

/** One finding of the doctor. */
export interface Check {
  status: Status;
  message: string;
}

const MARK: Record<Status, string> = { pass: "✓", warn: "!", fail: "✗" };

/** Settings that an instance with sign-in needs; a warning (not a failure) because sign-in may be off. */
export function settingChecks(env: NodeJS.ProcessEnv): Check[] {
  const origin = readSetting(env, "SHELF_PUBLIC_BASE_URL");
  const token = readSetting(env, "SHELF_ADMIN_TOKEN");
  return [
    origin
      ? { status: "pass", message: "SHELF_PUBLIC_BASE_URL is set" }
      : {
          status: "warn",
          message:
            "SHELF_PUBLIC_BASE_URL is not set: no confirmed origin, so no links or notifications",
        },
    token
      ? { status: "pass", message: "SHELF_ADMIN_TOKEN is set (purge and check-storage can run)" }
      : {
          status: "warn",
          message: "SHELF_ADMIN_TOKEN is not set: purge and check-storage cannot run",
        },
  ];
}

async function setupCheck(flags: ServerFlags): Promise<Check[]> {
  const { app, entry } = await loadInstance(flags.dir ?? process.cwd());
  const checks: Check[] = [{ status: "pass", message: `Instance module loaded (${entry})` }];
  try {
    await app.lifecycle.setup();
    const health = (await (
      await app.fetch(new Request("http://storyshelf.invalid/api/v1/health"))
    ).json()) as {
      testing?: boolean;
      auth?: boolean;
    };
    checks.push(
      { status: "pass", message: "Adapters set up and migrations applied" },
      {
        status: "pass",
        message: `Testing ${health.testing ? "on" : "off"}, sign-in ${health.auth === false ? "off" : "on"}`,
      },
    );
  } catch (error) {
    checks.push({ status: "fail", message: `Adapter setup failed: ${(error as Error).message}` });
  } finally {
    await app.lifecycle.teardown();
  }
  return checks;
}

/** `doctor`: the instance's module, adapters and settings. Exits 1 on a failed check. */
export async function doctor(flags: ServerFlags, io: Io, env = process.env): Promise<number> {
  let checks: Check[];
  try {
    checks = await setupCheck(flags);
  } catch (error) {
    checks = [{ status: "fail", message: (error as Error).message }];
  }
  const all = [...checks, ...settingChecks(env)];
  for (const check of all) io.out(`${MARK[check.status]} ${check.message}`);
  return all.some((check) => check.status === "fail") ? 1 : 0;
}
