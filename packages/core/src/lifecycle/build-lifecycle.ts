/**
 * The build status lifecycle (ADR 0046): every move a writer makes, as data. `BuildModel` writes a
 * status only from the states this table allows for it, and the status lists (terminal, cancellable,
 * open) are derived here, so a new status is one table change.
 */

/** All lifecycle statuses a build can carry. */
export const BUILD_STATUSES = [
  "pending",
  "capturing",
  "comparing",
  "reviewing",
  "approved",
  "rejected",
  "failed",
  "cancelled",
  "skipped",
] as const;

/** Lifecycle status of a build. */
export type BuildStatus = (typeof BUILD_STATUSES)[number];

/** The ordinary moves, `from → to[]`: what capture, publish, review and cancel do while a build runs. */
const ORDINARY: Readonly<Record<BuildStatus, readonly BuildStatus[]>> = {
  // Capture starts; publish and `acceptPendingWithoutWork` accept; a verdict decides; a crash or a
  // failed publish fails; a user cancels.
  pending: ["capturing", "approved", "rejected", "failed", "cancelled"],
  // Finalize decides (`reviewing`, `approved`, `failed`); a crash fails; a user cancels.
  capturing: ["reviewing", "approved", "failed", "cancelled"],
  // No writer sets `comparing` today; a build found in it can still be cancelled.
  comparing: ["cancelled"],
  // The snapshot rollup decides.
  reviewing: ["approved", "rejected"],
  approved: [],
  rejected: [],
  failed: [],
  cancelled: [],
  // Entry-only (below): a skipped build repeats its source's outcome and nothing moves it.
  skipped: [],
};

/**
 * The entry-only states (ADR 0046, ADR 0044): a row is created in one and no write moves a build to
 * or from it. They are terminal, and neither the idempotent same-status write nor a named exit
 * applies, so a `skipped` build can be neither written again nor retried, cancelled or reviewed.
 */
export const ENTRY_ONLY_BUILD_STATUSES: readonly BuildStatus[] = ["skipped"];

/** Whether `status` is entry-only: created in, never moved to or from. */
export function isEntryOnly(status: BuildStatus): boolean {
  return ENTRY_ONLY_BUILD_STATUSES.includes(status);
}

/**
 * The named exits: moves that leave a terminal state, each tied to one operation. Anything else
 * that leaves `approved`, `rejected`, `failed` or `cancelled` is refused.
 */
export const BUILD_EXITS = {
  /** `resetStatus` (the retry route): any build goes back to `pending` for a new run. */
  retry: BUILD_STATUSES.filter((from) => !isEntryOnly(from)).map(
    (from) => [from, "pending"] as const,
  ),
  /** A reviewer's verdict (ADR 0013) moves a reviewed build between verdicts or reopens it. */
  verdict: [
    ["approved", "rejected"],
    ["rejected", "approved"],
    ["approved", "pending"],
    ["rejected", "pending"],
  ],
  /** The snapshot rollup reopens a reviewed build when a snapshot is un-approved. */
  snapshotRollup: [
    ["approved", "reviewing"],
    ["rejected", "reviewing"],
  ],
} as const satisfies Record<string, readonly (readonly [BuildStatus, BuildStatus])[]>;

/** Name of a terminal-state exit. */
export type BuildExit = keyof typeof BUILD_EXITS;

/** Whether `from → to` is an ordinary move. */
function isOrdinary(from: BuildStatus, to: BuildStatus): boolean {
  return ORDINARY[from].includes(to);
}

/** Whether `from → to` is one of the named exit `exit`'s moves. */
export function isExit(exit: BuildExit, from: BuildStatus, to: BuildStatus): boolean {
  return BUILD_EXITS[exit].some(([a, b]) => a === from && b === to);
}

/**
 * Whether a write may move a build from `from` to `to`. Writing the status a row already has is an
 * idempotent no-op and allowed, except for an entry-only status (a redelivered capture, a rollup that changes nothing).
 */
export function canMove(from: BuildStatus, to: BuildStatus): boolean {
  if (isEntryOnly(from) || isEntryOnly(to)) return false;
  if (from === to || isOrdinary(from, to)) return true;
  return Object.keys(BUILD_EXITS).some((exit) => isExit(exit as BuildExit, from, to));
}

/** The states a build may be in for a write of `to` to apply (the compare-and-set's `IN` list). */
export function allowedFrom(to: BuildStatus): readonly BuildStatus[] {
  return BUILD_STATUSES.filter((from) => canMove(from, to));
}

/** {@link allowedFrom} without `to` itself: the states a write of `to` really changes. */
export function enteringFrom(to: BuildStatus): readonly BuildStatus[] {
  return allowedFrom(to).filter((from) => from !== to);
}

/** The states a named exit leaves for `to`. */
export function exitFrom(exit: BuildExit, to: BuildStatus): readonly BuildStatus[] {
  return BUILD_EXITS[exit].flatMap(([from, target]) => (target === to ? [from] : []));
}

/**
 * Terminal statuses: no ordinary move leaves them (a named exit may). Only builds that have
 * finished are eligible for TTL-based retention purging; `pending` and `reviewing` builds are kept.
 */
export const TERMINAL_BUILD_STATUSES: readonly BuildStatus[] = BUILD_STATUSES.filter(
  (status) => ORDINARY[status].length === 0,
);

/**
 * Statuses of a build whose capture or compare work may still run: a user may cancel it (the build
 * then ends `cancelled`, a terminal status no capture write moves it out of again).
 */
export const CANCELLABLE_BUILD_STATUSES: readonly BuildStatus[] = BUILD_STATUSES.filter((status) =>
  isOrdinary(status, "cancelled"),
);

/** Statuses that are not terminal: the build is still waiting on capture or a decision. */
export const OPEN_BUILD_STATUSES: readonly BuildStatus[] = BUILD_STATUSES.filter(
  (status) => !TERMINAL_BUILD_STATUSES.includes(status),
);
