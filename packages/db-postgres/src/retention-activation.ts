/**
 * Switch on lifecycle-aware retention for a Postgres preset (ADR 0039): once the schema is migrated,
 * prepare the baseline pins, then expose `buildReferenceLifecycle`. A recorded baseline source the
 * preparation must not touch leaves the capability off (retention stays fail closed) and is
 * reported through `retentionPause`; fixing the data and restarting turns it on.
 *
 * Only a preset whose every connection is a real session of a shared server calls this (the
 * lifecycle opens one transaction per operation and relies on row locks between sessions).
 */
import type {
  BuildReferenceLifecycle,
  DatabaseAdapter,
  RetentionPause,
} from "@storyshelf/core/adapter/database";
import { BaselineSourceIntegrityError } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
import { prepareBaselineReferences } from "./baseline-preparation.ts";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";

/** What boot decided; read through getters, so the adapter reflects a later activation. */
export interface RetentionActivation {
  lifecycle?: BuildReferenceLifecycle;
  pause?: RetentionPause;
  logger?: Logger;
}

/**
 * Prepare the baselines and expose the capability. Any failure other than a
 * {@link BaselineSourceIntegrityError} propagates: the boot fails rather than guess.
 */
export async function activateRetention(
  database: unknown,
  state: RetentionActivation,
): Promise<void> {
  delete state.lifecycle;
  delete state.pause;
  try {
    await prepareAndExpose(database, state);
  } catch (error) {
    if (!(error instanceof BaselineSourceIntegrityError)) throw error;
    pauseRetention(state, error);
  }
}

async function prepareAndExpose(database: unknown, state: RetentionActivation): Promise<void> {
  const startedAt = performance.now();
  const prepared = await prepareBaselineReferences(database);
  state.lifecycle = createBuildReferenceLifecycle(database);
  state.logger?.info(
    { ...prepared, ms: Math.round(performance.now() - startedAt) },
    "baseline references prepared; build retention is active",
  );
}

/** Keep the capability off and say why, once, so the System page and the log agree. */
function pauseRetention(state: RetentionActivation, error: BaselineSourceIntegrityError): void {
  const { baselineId, buildId, problem } = error;
  state.pause = { baselineId, buildId, problem };
  state.logger?.error(
    { baselineId, buildId, problem },
    "retention is paused: a baseline has an invalid source build; fix the data and restart",
  );
}

/** Define the capability, the pause and `setLogger` on the adapter, reading `state` when asked. */
export function attachRetention(
  adapter: DatabaseAdapter,
  state: RetentionActivation,
): DatabaseAdapter {
  Object.defineProperties(adapter, {
    // Assignable, so a test can swap in a wrapped capability; production code only reads it.
    buildReferenceLifecycle: {
      enumerable: true,
      get: () => state.lifecycle,
      set: (value: BuildReferenceLifecycle | undefined) => {
        state.lifecycle = value;
      },
    },
    retentionPause: { enumerable: true, get: () => state.pause },
    setLogger: {
      enumerable: true,
      value: (logger: Logger): void => {
        state.logger = logger;
      },
    },
  });
  return adapter;
}
