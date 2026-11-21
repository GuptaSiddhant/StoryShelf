// What a release must do with a job, from the payload versions its handlers declare (ADR 0053,
// decision 5). The mixed-queue test never hard-codes a version: the previous release reports its
// own (`mixed-queue-previous.mjs`), this checkout's come from its own handlers.

/** The highest payload version each kind's handler reads, by job kind. */
export type Declared = Readonly<Record<string, number>>;

/** `run`: the release runs it exactly once; `hand-back`: it leaves it queued, no attempt spent. */
export type Expectation = "run" | "hand-back";

/** A job at or below the declared version runs; a newer one is handed back. A kind with no handler throws. */
export function expectedOn(declared: Declared, job: { kind: string; v: number }): Expectation {
  const version = declared[job.kind];
  if (version === undefined) throw new Error(`the release declares no handler for ${job.kind}`);
  return job.v <= version ? "run" : "hand-back";
}

/** A payload version above everything either release declares, so the refuse path is always hit. */
export const SYNTHETIC_VERSION = 99;

/** Throws when {@link SYNTHETIC_VERSION} is not above every declared version (raise it). */
export function assertAboveAll(...releases: Declared[]): void {
  for (const declared of releases)
    for (const [kind, version] of Object.entries(declared))
      if (version >= SYNTHETIC_VERSION)
        throw new Error(`${kind} declares v${version}; raise SYNTHETIC_VERSION above it`);
}
