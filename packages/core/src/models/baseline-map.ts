/** A capture pass's baselines, keyed for in-memory lookup. */
import { DEFAULT_BROWSER } from "../adapters/capture-runner.ts";
import type { Baseline } from "../schema/baseline.ts";

/**
 * A pass's baselines, resolved: for each `(storyId, viewport, browser)` the branch's own row, else the default
 * branch's. Built by {@link BaselineModel.loadFor}; a read, not a lock (the fenced writers still decide).
 */
export class BaselineMap {
  readonly #rows = new Map<string, Baseline>();

  static #key(storyId: string, viewport: string, browser: string): string {
    return JSON.stringify([storyId, viewport, browser]);
  }

  /** Add a row unless that key already has one: the caller adds the branch's own rows first. */
  add(row: Baseline): void {
    const key = BaselineMap.#key(row.storyId, row.viewportName, row.browser ?? DEFAULT_BROWSER);
    if (!this.#rows.has(key)) this.#rows.set(key, row);
  }

  get(storyId: string, viewport: string, browser: string = DEFAULT_BROWSER): Baseline | null {
    return this.#rows.get(BaselineMap.#key(storyId, viewport, browser)) ?? null;
  }
}
