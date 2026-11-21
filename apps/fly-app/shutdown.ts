/**
 * The bound of the SIGTERM drain (#912). `SHELF_SHUTDOWN_GRACE_SECONDS` sets it: jobs still running near
 * its end are handed back to the queue, without spending an attempt, for another machine to take
 * over. Set it a few seconds below the platform's stop timeout. On Fly with no value it is
 * {@link FLY_DEFAULT_GRACE_SECONDS}, below Fly's default `kill_timeout` of 5 s; elsewhere, unset
 * leaves the drain unbounded. A value that is not a whole number of seconds stops the boot.
 */
import { readSetting } from "@storyshelf/core/config";

/** Grace on Fly when `SHELF_SHUTDOWN_GRACE_SECONDS` is unset: Fly kills the machine 5 s after the signal. */
export const FLY_DEFAULT_GRACE_SECONDS = 3;

/** The drain's bound in ms, or undefined for an unbounded drain. */
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

/** How long past the drain's grace the process may run (rest of teardown, closing the listener). */
export const FORCED_EXIT_MS = 1000;

/**
 * Bound the life of a process told to stop (#912): armed when the signal arrives, it exits at
 * `graceMs + FORCED_EXIT_MS` whatever the teardown is doing, stalled or failed included. A released
 * job whose handler never stopped is left to its lease, and only the process ending stops that
 * handler before the lease runs out. The timer is unref'd, so a process with nothing left running
 * exits on its own first.
 */
export function exitBy(
  graceMs: number,
  // oxlint-disable-next-line unicorn/no-process-exit -- a stuck handler must not outlive the drain
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  setTimeout(() => {
    exit(0);
  }, graceMs + FORCED_EXIT_MS).unref();
}
