import { decideMigration, readSchemaRelease } from "@storyshelf/core/adapter/database";
import { readSetting } from "@storyshelf/core/config";
import { packageVersion } from "../../package-version.ts";
import { buildInstance, loadInstance, type BuiltInstance } from "../instance.ts";
import type { CommandContext } from "./context.ts";
import { peerChecks } from "./peer-checks.ts";

type Status = "pass" | "warn" | "fail";

/** One finding of the doctor. */
export interface Check {
  status: Status;
  message: string;
}

const MARK: Record<Status, string> = { pass: "✓", warn: "!", fail: "✗" };

/** Settings of the instance's own environment; warnings, because the instance may not need them. */
export function settingChecks(env: NodeJS.ProcessEnv, adminToken: string | undefined): Check[] {
  const origin = readSetting(env, "SHELF_PUBLIC_BASE_URL");
  return [
    origin
      ? { status: "pass", message: "SHELF_PUBLIC_BASE_URL is set" }
      : {
          status: "warn",
          message:
            "SHELF_PUBLIC_BASE_URL is not set: no confirmed origin, so no links or notifications",
        },
    adminToken
      ? {
          status: "pass",
          message: "The instance has an admin token (purge and check-storage can run)",
        }
      : {
          status: "warn",
          message:
            "The instance has no admin token (SHELF_ADMIN_TOKEN): purge and check-storage cannot run",
        },
  ];
}

/** The schema level: what migrated the database, against this release. Read-only. */
export async function schemaCheck(built: BuiltInstance, own = packageVersion()): Promise<Check> {
  const recorded = await readSchemaRelease(built.options.database);
  if (recorded === null) {
    return {
      status: "warn",
      message:
        "Schema level: unknown (no schema_meta row): not migrated yet, or the database is unreachable. Run `storyshelf-server migrate`.",
    };
  }
  if (decideMigration(own, recorded) === "refuse") {
    return {
      status: "fail",
      message: `Schema level: migrated by release ${recorded}, more than one minor newer than this release ${own}`,
    };
  }
  return {
    status: "pass",
    message: `Schema level: migrated by release ${recorded} (this release ${own})`,
  };
}

async function instanceChecks(
  ctx: CommandContext,
): Promise<{ checks: Check[]; built?: BuiltInstance }> {
  const loaded = await loadInstance(ctx.flags.dir ?? process.cwd(), ctx.flags.entry);
  const checks: Check[] = [{ status: "pass", message: `Instance module loaded (${loaded.entry})` }];
  try {
    const built = await buildInstance(loaded, "tool", ctx.env);
    checks.push({ status: "pass", message: "The instance factory built its options and the app" });
    return { checks, built };
  } catch (error) {
    checks.push({
      status: "fail",
      message: `The instance factory failed: ${(error as Error).message}`,
    });
    return { checks };
  }
}

/** The checks that need the built app; it is torn down afterwards, whatever they find. */
async function builtChecks(built: BuiltInstance, env: NodeJS.ProcessEnv): Promise<Check[]> {
  try {
    const adminToken = built.options.config?.adminToken ?? env["SHELF_ADMIN_TOKEN"];
    return [await schemaCheck(built), ...settingChecks(env, adminToken)];
  } finally {
    await built.app.lifecycle.teardown();
  }
}

/**
 * `doctor`: the installed `@storyshelf/*` packages and their peers (read before the instance module is
 * imported, so a missing peer is named rather than a stack trace), the instance module, its factory,
 * the schema level and the settings. A `tool`: it never
 * migrates, sets an adapter up or starts a consumer, so it is safe on a running instance. Exits 1 on
 * a failed check.
 */
export async function doctor(ctx: CommandContext): Promise<number> {
  const installed = peerChecks(ctx.flags.dir ?? process.cwd());
  let checks: Check[];
  try {
    const found = await instanceChecks(ctx);
    const rest = found.built
      ? await builtChecks(found.built, ctx.env)
      : settingChecks(ctx.env, undefined);
    checks = [...installed, ...found.checks, ...rest];
  } catch (error) {
    checks = [
      ...installed,
      { status: "fail", message: (error as Error).message },
      ...settingChecks(ctx.env, undefined),
    ];
  }
  for (const check of checks) ctx.io.out(`${MARK[check.status]} ${check.message}`);
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}
