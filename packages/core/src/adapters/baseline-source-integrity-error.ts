/** Why a baseline's recorded source build cannot be pinned. */
export type BaselineSourceProblem = "tombstoned" | "other-project";

/**
 * Baseline reference preparation found a recorded source it must not touch: the build is being
 * deleted (a tombstone is never revived) or belongs to another project. Preparation stops and
 * rolls back; nothing is cleared or guessed. Names the baseline and the build.
 */
export class BaselineSourceIntegrityError extends Error {
  readonly baselineId: string;
  readonly buildId: string;
  readonly problem: BaselineSourceProblem;

  constructor(baselineId: string, buildId: string, problem: BaselineSourceProblem) {
    const why =
      problem === "tombstoned" ? "is being deleted (tombstoned)" : "belongs to another project";
    super(`Baseline ${baselineId}: its source build ${buildId} ${why}`);
    this.name = "BaselineSourceIntegrityError";
    this.baselineId = baselineId;
    this.buildId = buildId;
    this.problem = problem;
  }
}
