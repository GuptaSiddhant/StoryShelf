import { printError } from "../output.ts";

let warned = false;

/**
 * Warn once per process that a token passed as `--token` shows in the process list. Names the flag
 * and the variable to use instead, never the value; says nothing when no flag was given.
 *
 * @param flagValue - The value of `--token`, or undefined when the flag was not passed.
 */
export function warnTokenFlag(flagValue?: string): void {
  if (flagValue === undefined || warned) {
    return;
  }
  warned = true;
  printError(
    "Warning: --token puts the secret in the process list, where other users and logs can read it. Set SHELF_TOKEN in the environment instead.",
  );
}

/** Test seam: forget that the warning was shown. */
export function resetTokenFlagWarning(): void {
  warned = false;
}
