/**
 * The notes stored beside axe findings in a snapshot's `a11y_violations` list. A note describes the
 * run, never a violation: readers keep it out of every finding count, and nothing here changes a
 * status. This module is the one owner of the three shapes.
 */

const AXE_UNAVAILABLE_PREFIX = "axe unavailable: ";
const PARAMETERS_PREFIX = "a11y parameters not serializable: ";
const BASELINE_PREFIX = "from baseline ";

/** Short sha shown for the baseline build an inherited snapshot's findings come from. */
export const BASELINE_SHA_LENGTH = 7;

/** Axe could not be loaded or run; the reason follows. */
export function axeUnavailableNote(reason: string): string {
  return `${AXE_UNAVAILABLE_PREFIX}${reason}`;
}

/** The story's `parameters.a11y` could not be turned into plain data, so axe ran with its defaults. */
export function parametersNote(reason: string): string {
  return `${PARAMETERS_PREFIX}${reason}`;
}

/** Marks the findings that follow as measured on the baseline build, not on this one. */
export function baselineNote(sha: string): string {
  return `${BASELINE_PREFIX}${sha.slice(0, BASELINE_SHA_LENGTH)}`;
}

/** The reason axe did not run, or undefined when `text` is not that note. */
export function axeUnavailableReason(text: string): string | undefined {
  return text.startsWith(AXE_UNAVAILABLE_PREFIX)
    ? text.slice(AXE_UNAVAILABLE_PREFIX.length)
    : undefined;
}

/** Why the story's a11y parameters were not applied, or undefined when `text` is not that note. */
export function parametersReason(text: string): string | undefined {
  return text.startsWith(PARAMETERS_PREFIX) ? text.slice(PARAMETERS_PREFIX.length) : undefined;
}

/** The baseline sha of a `from baseline <sha>` note, or undefined when `text` is not that note. */
export function baselineSha(text: string): string | undefined {
  return text.startsWith(BASELINE_PREFIX) ? text.slice(BASELINE_PREFIX.length) : undefined;
}

/** Whether a stored entry is any of the notes (so not a finding). */
export function isA11yNote(text: string): boolean {
  return (
    axeUnavailableReason(text) !== undefined ||
    parametersReason(text) !== undefined ||
    baselineSha(text) !== undefined
  );
}
