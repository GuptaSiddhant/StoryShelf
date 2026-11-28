/**
 * Switch on lifecycle-aware retention for a SQLite file (ADR 0039): once the schema is migrated,
 * prepare the baseline pins, then expose `buildReferenceLifecycle`. A recorded baseline source the
 * preparation must not touch leaves the capability off (retention stays fail closed) and is
 * reported through `retentionPause`; fixing the data and restarting turns it on.
 */
import type {
  BuildReferenceLifecycle,
  DatabaseAdapter,
  ReadOnlyRetentionContext,
  RetentionPause,
} from "@storyshelf/core/adapter/database";
import {
  assertRetentionReady,
  BaselineSourceIntegrityError,
  RetentionNotReadyError,
  sqlSchemaLevelStore,
} from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
import { DatabaseSync } from "node:sqlite";
import {
  createBuildReferenceLifecycle,
  prepareBaselineReferences,
} from "./build-reference-lifecycle.ts";

/** What boot decided; read through getters, so the adapter reflects a later activation. */
export interface RetentionActivation {
  lifecycle?: BuildReferenceLifecycle;
  pause?: RetentionPause;
  logger?: Logger;
}

/**
 * Prepare the baselines and expose the capability. A shared file is required (the lifecycle opens
 * its own connections), so an in-memory database never gets one. Any failure other than a
 * {@link BaselineSourceIntegrityError} propagates: the boot fails rather than guess.
 */
export async function activateRetention(path: string, state: RetentionActivation): Promise<void> {
  delete state.lifecycle;
  delete state.pause;
  if (path === ":memory:") return;
  try {
    await prepareAndExpose(path, state);
  } catch (error) {
    if (!(error instanceof BaselineSourceIntegrityError)) throw error;
    pauseRetention(state, error);
  }
}

async function prepareAndExpose(path: string, state: RetentionActivation): Promise<void> {
  const startedAt = performance.now();
  const prepared = await prepareBaselineReferences(path);
  state.lifecycle = createBuildReferenceLifecycle(path);
  state.logger?.info(
    { ...prepared, ms: Math.round(performance.now() - startedAt) },
    "baseline references prepared; build retention is active",
  );
}

/**
 * For a `tool` command: expose the lifecycle when this release already prepared the file, judged
 * from a read-only connection. Never migrates, writes `schema_meta` or prepares the pins; the
 * lifecycle it exposes opens its own connections and takes the same write lock as the server's,
 * so a second process beside a running server serializes with it exactly as two requests do.
 */
export async function activateRetentionReadOnly(
  path: string,
  state: RetentionActivation,
  context: ReadOnlyRetentionContext,
): Promise<void> {
  delete state.lifecycle;
  delete state.pause;
  if (path === ":memory:") {
    throw new RetentionNotReadyError("Build retention needs a database file, not memory.");
  }
  const sqlite = new DatabaseSync(path, { readOnly: true, returnArrays: true });
  try {
    const query = async (sql: string): Promise<unknown[]> =>
      await Promise.resolve(sqlite.prepare(sql).all());
    await assertRetentionReady({
      release: context.release,
      store: sqlSchemaLevelStore(query, "sqlite"),
      query,
    });
  } finally {
    sqlite.close();
  }
  state.lifecycle = createBuildReferenceLifecycle(path);
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
  readOnly?: (context: ReadOnlyRetentionContext) => Promise<void>,
): DatabaseAdapter {
  if (readOnly) {
    Object.defineProperty(adapter, "activateRetentionReadOnly", {
      enumerable: true,
      value: readOnly,
    });
  }
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
