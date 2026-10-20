/** In-flight render calls of a capture runner, so `cancel` reaches exactly the runs it names. */

/**
 * Every render call a runner has in flight, by build and run id.
 *
 * Several renders of one build can run at once in one process (the shards of a sharded build), and
 * even two with the same run id (a redelivered shard). Each call registers its own entry and
 * removes only that entry when it ends, so no render ever drops another's handle.
 */
export class RenderRuns<T> {
  readonly #byBuild = new Map<string, Set<{ runId: string; run: T }>>();

  /**
   * Register a render call. Returns the function that removes it again (call it in `finally`).
   *
   * @param runId - The request's run id; a render without one is keyed by its build id.
   */
  add(buildId: string, runId: string | undefined, run: T): () => void {
    const entry = { runId: runId ?? buildId, run };
    const runs = this.#byBuild.get(buildId) ?? new Set();
    runs.add(entry);
    this.#byBuild.set(buildId, runs);
    return () => {
      runs.delete(entry);
      if (runs.size === 0 && this.#byBuild.get(buildId) === runs) {
        this.#byBuild.delete(buildId);
      }
    };
  }

  /** The runs `cancel(buildId, runId)` should stop: every run of the build without a run id. */
  matching(buildId: string, runId?: string): T[] {
    const runs = [...(this.#byBuild.get(buildId) ?? [])];
    return runs.filter((entry) => runId === undefined || entry.runId === runId).map((e) => e.run);
  }
}
