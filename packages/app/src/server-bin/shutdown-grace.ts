/**
 * The bound of the SIGTERM shutdown (#912), passed to `startServer` as `shutdownTimeoutMs`.
 * `SHELF_SHUTDOWN_GRACE_SECONDS` sets it: jobs still running near its end are handed back to the
 * queue, without spending an attempt, for another machine to take over. Set it a few seconds below
 * the platform's stop timeout. On Fly with no value it is {@link FLY_DEFAULT_GRACE_SECONDS}, below
 * Fly's default `kill_timeout` of 5 s; elsewhere, unset leaves `startServer`'s default (30 s). A
 * value that is not a whole number of seconds stops the boot.
 */
import { readSetting } from "@storyshelf/core/config";

/** Grace on Fly when `SHELF_SHUTDOWN_GRACE_SECONDS` is unset: Fly kills the machine 5 s after the signal. */
export const FLY_DEFAULT_GRACE_SECONDS = 3;

/** The shutdown's bound in ms, or undefined for `startServer`'s default. */
export function shutdownGraceMs(
  env: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const raw = readSetting(env, "SHELF_SHUTDOWN_GRACE_SECONDS");
  if (raw === undefined || raw === "") {
    return env["FLY_APP_NAME"] ? FLY_DEFAULT_GRACE_SECONDS * 1000 : undefined;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error("SHELF_SHUTDOWN_GRACE_SECONDS must be a whole number of seconds");
  }
  return Number(raw) * 1000;
}
