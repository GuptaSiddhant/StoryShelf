import { readSetting } from "@storyshelf/core/config";

type Env = Readonly<Record<string, string | undefined>>;

/** Settings that turn sign-in on; both are needed (`createShelfAuth` refuses an empty secret). */
const REQUIRED = ["SHELF_ADMIN_PASSWORD", "SHELF_SECRET"] as const;

/**
 * On Fly (`FLY_APP_NAME` is set by the platform) the public demo must never boot open (#1360).
 * Throws, naming each missing setting, so the deploy's health check fails and Fly keeps the previous
 * machine. `SHELF_ALLOW_NO_AUTH=1` is the explicit opt-out for a deliberately open demo; a run
 * without `FLY_APP_NAME` (development) keeps auth off when no password is set. Never prints a value.
 */
export function requireAuthOnFly(env: Env): void {
  if (!env["FLY_APP_NAME"] || readSetting(env, "SHELF_ALLOW_NO_AUTH") === "1") return;
  const missing = REQUIRED.filter((name) => !readSetting(env, name));
  if (missing.length === 0) return;
  throw new Error(
    `The Fly demo refuses to start without sign-in. Set ${missing.join(" and ")} ` +
      "(fly secrets set ...), or SHELF_ALLOW_NO_AUTH=1 to run it open on purpose.",
  );
}
