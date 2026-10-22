/** Poll and cancel-check cadence of the database queue (ADR 0006, decision 11). */

/** Poll interval of an idle instance. */
export const IDLE_POLL_MS = 15_000;
/** Poll interval while jobs were recently queued or found. */
export const ACTIVE_POLL_MS = 2000;
/** How long after the last job seen an instance keeps polling at the active rate. */
export const ACTIVE_WINDOW_MS = 60_000;
/** Each delay is stretched by up to this fraction (never shortened, so idle stays ≥ 15 s). */
export const POLL_JITTER = 0.2;
/** How often a running job reads its own row for cancel. */
export const CANCEL_CHECK_MS = 5000;

/** Tunable cadence; tests shrink it, production uses the defaults above. */
export interface PollCadence {
  idleMs: number;
  activeMs: number;
  activeWindowMs: number;
  jitter: number;
}

/** The cadence ADR 0006 fixes. */
export const DEFAULT_CADENCE: PollCadence = {
  idleMs: IDLE_POLL_MS,
  activeMs: ACTIVE_POLL_MS,
  activeWindowMs: ACTIVE_WINDOW_MS,
  jitter: POLL_JITTER,
};

/**
 * Delay before the next poll: the active interval while the last job was seen (found by a poll or
 * queued locally) within the active window, otherwise the idle interval; plus jitter in
 * `[0, jitter)` of it, so instances started together drift apart instead of probing in lockstep.
 */
export function nextPollDelay(
  lastWorkAt: number | null,
  now: number,
  cadence: PollCadence = DEFAULT_CADENCE,
  random: () => number = Math.random,
): number {
  const active = lastWorkAt !== null && now - lastWorkAt < cadence.activeWindowMs;
  const base = active ? cadence.activeMs : cadence.idleMs;
  return Math.round(base * (1 + cadence.jitter * clampUnit(random())));
}

function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 0.999999);
}
