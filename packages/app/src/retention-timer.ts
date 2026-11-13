import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Auth } from "@storyshelf/core/auth";
import type { ShelfConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
/* oxlint-disable typescript/promise-function-async -- interval helpers return promise factories */
import { ProjectModel } from "@storyshelf/core/models";
import {
  Retention,
  purgeAiData,
  reclaimBuildCopies,
  type AiRetention,
} from "@storyshelf/core/retention";

const DEFAULT_BRANCH_TTL_DAYS = 30;
const DEFAULT_EXPIRED_AUTH_TTL_DAYS = 7;
const DEFAULT_BRANCH_GC_INTERVAL_MS = 86_400_000;

/** Pages of 50 builds the per-build copy reclaim visits in one sweep; the next sweep resumes from its cursor. */
const RECLAIM_PAGES_PER_SWEEP = 20;

/** Handle for the background branch-GC interval; call `stop()` on server shutdown. */
export interface BranchGcTimer {
  stop(): void;
}

/** What one sweep needs; `warned` keeps the "no capability" notice to once per timer. */
interface SweepContext {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  logger: Logger;
  /** Branch baseline TTL; null: branch GC is off. */
  branchTtlDays: number | null;
  /** Build purge TTL; undefined: scheduled build purge is off (the default). */
  purgeTtlDays: number | undefined;
  testing: boolean;
  /** AI table retention windows from config (days; null keeps rows). */
  retention: AiRetention;
  /** Days after expiry that session and verification rows are deleted; null keeps them. */
  expiredAuthTtlDays: number | null;
  /** Auth singleton whose expired rows are swept, when auth is on. */
  auth: Auth | undefined;
  /** Resolves with the adapter setup result; a sweep waits for it and runs only when it succeeded. */
  ready: () => Promise<{ ok: boolean }>;
  /** Set by `stop()`: a sweep that was waiting for setup must not start after shutdown began. */
  stopped: boolean;
  /** Aborted by `stop()`: a running batched stage stops between builds. */
  signal: AbortSignal;
  warned: boolean;
}

/**
 * Start the daily retention sweep: it removes baselines of branches not updated within
 * `branchTtlDays` and, only when `purgeTtlDays` is set explicitly (there is no default, so an
 * upgrade never starts deleting builds), builds older than `purgeTtlDays`. Both need the database's
 * lifecycle capability in a testing deployment (ADR 0039), and the scheduled build purge needs it
 * everywhere: it runs only the capability's deletion path. Returns a timer handle or `null` when
 * there is nothing to schedule (`branchTtlDays: null` and no `purgeTtlDays`, or a non-positive
 * interval).
 *
 * @param db - Database adapter to list projects
 * @param storage - Storage adapter for baseline and build cleanup
 * @param config - Shelf config supplying `branchTtlDays`, `purgeTtlDays` and `branchGcIntervalMs`
 * @param logger - Structured logger for sweep diagnostics
 * @param testing - Whether the deployment has testing enabled
 * @param ready - Adapter setup result; every sweep waits for it and is skipped if setup failed
 * @returns Timer handle with `stop()`, or `null` if nothing is scheduled
 */
export function startBranchGcTimer(
  db: DatabaseAdapter,
  storage: StorageAdapter,
  config: ShelfConfig,
  logger: Logger,
  testing = false,
  ready: () => Promise<{ ok: boolean }> = async () => await Promise.resolve({ ok: true }),
  auth?: Auth,
): BranchGcTimer | null {
  const branchTtlDays =
    config.branchTtlDays === undefined ? DEFAULT_BRANCH_TTL_DAYS : config.branchTtlDays;
  const intervalMs = config.branchGcIntervalMs ?? DEFAULT_BRANCH_GC_INTERVAL_MS;
  // The AI-data and expired-auth sweeps always run, so only a non-positive interval turns it off.
  if (intervalMs <= 0) {
    return null;
  }
  const stop = new AbortController();
  const context: SweepContext = {
    db,
    storage,
    logger,
    branchTtlDays,
    purgeTtlDays: config.purgeTtlDays,
    testing,
    retention: { insightDays: config.insightsTtlDays, usageDays: config.aiUsageTtlDays },
    expiredAuthTtlDays:
      config.expiredAuthTtlDays === undefined
        ? DEFAULT_EXPIRED_AUTH_TTL_DAYS
        : config.expiredAuthTtlDays,
    auth,
    ready,
    stopped: false,
    signal: stop.signal,
    warned: false,
  };
  return scheduleBranchGc(createSweepRunner(context), intervalMs, () => {
    context.stopped = true;
    stop.abort();
  });
}

// oxlint-disable-next-line typescript/promise-function-async
function createSweepRunner(context: SweepContext): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      // The database is not usable, and its retention capability not known, until setup is done.
      if (!(await context.ready()).ok || context.stopped) return;
      await sweep(context);
    } catch (error) {
      context.logger.error({ err: error }, "retention sweep failed");
    }
  };
}

async function sweep(context: SweepContext): Promise<void> {
  const { db, branchTtlDays, purgeTtlDays, testing } = context;
  // Baseline removal must be coordinated with references: a testing deployment GCs branches only
  // when its database has the lifecycle capability. Independent AI-data cleanup always runs, and
  // each stage fails on its own: a build-purge error must not stop the others.
  // While retention is paused (a baseline's source build cannot be pinned) the unfenced path would
  // delete baseline rows without releasing their references, so branch GC waits for the fix too.
  if (branchTtlDays !== null && !db.retentionPause && (!testing || db.buildReferenceLifecycle)) {
    await stage(context, "branch GC", async () => {
      await sweepBranches(context, branchTtlDays);
    });
  }
  if (purgeTtlDays !== undefined) {
    await stage(context, "build purge", async () => {
      await sweepBuilds(context, purgeTtlDays);
    });
  }
  await stage(context, "build copy reclaim", async () => {
    await sweepBuildCopies(context);
  });
  await stage(context, "AI data cleanup", async () => {
    await purgeAiData(db, new Date(), context.logger, context.retention);
  });
  await stage(context, "expired auth rows", async () => {
    await sweepExpiredAuth(context);
  });
}

/**
 * Reclaim the per-build Storybook copies kept before published files were stored once (#850): a
 * bounded number of pages per sweep, resumed from a saved cursor, idempotent, never at boot. It is
 * not a job kind, so it adds no new queue row type (ADR 0053).
 */
async function sweepBuildCopies(context: SweepContext): Promise<void> {
  const { db, storage, logger, signal } = context;
  for (let page = 0; page < RECLAIM_PAGES_PER_SWEEP && !signal.aborted; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one page at a time; the cursor is saved per build
    const result = await reclaimBuildCopies({ db, storage, logger, signal });
    if (result.done) return;
  }
}

/** Delete session and verification rows that expired `expiredAuthTtlDays` ago (batched by the auth engine). */
async function sweepExpiredAuth(context: SweepContext): Promise<void> {
  const { auth, expiredAuthTtlDays } = context;
  if (!auth?.purgeExpired || expiredAuthTtlDays === null) return;
  const cutoff = new Date(Date.now() - expiredAuthTtlDays * 86_400_000).toISOString();
  const removed = await auth.purgeExpired(cutoff);
  if (removed.sessions > 0 || removed.verifications > 0) {
    context.logger.info(removed, "expired auth rows removed");
  }
}

/** Run one stage of the sweep; a failure is logged and leaves the next stage to run. */
async function stage(context: SweepContext, name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    context.logger.error({ err: error, stage: name }, "retention sweep stage failed");
  }
}

function retentionFor(context: SweepContext): Retention {
  const { db, storage, logger } = context;
  return new Retention(
    db,
    storage,
    {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      baselines: db.tables.baselines,
    },
    logger,
  );
}

async function sweepBranches(context: SweepContext, ttlDays: number): Promise<void> {
  const retention = retentionFor(context);
  const projects = await new ProjectModel(context.db).list();
  const results = await Promise.all(
    projects.map((project) => retention.purgeStaleBranches(project, ttlDays)),
  );
  const totalBranches = results.reduce((sum, result) => sum + result.removedBranches, 0);
  const totalBaselines = results.reduce((sum, result) => sum + result.removedBaselines, 0);
  if (totalBranches > 0 || totalBaselines > 0) {
    context.logger.info({ totalBranches, totalBaselines }, "branch GC daily sweep complete");
  }
}

/** Scheduled build purge: the lifecycle capability's deletion path only; without it, nothing is deleted. */
async function sweepBuilds(context: SweepContext, ttlDays: number): Promise<void> {
  // Read once for the whole pass and handed to every deletion (ADR 0039).
  const lifecycle = context.db.buildReferenceLifecycle;
  if (!lifecycle) {
    warnNoCapability(context, ttlDays);
    return;
  }
  const retention = retentionFor(context);
  const projects = await new ProjectModel(context.db).list();
  const results = await Promise.all(
    projects.map((project) =>
      retention.purge(project, { ttlDays, keepLatestPerBranch: true, lifecycle }),
    ),
  );
  const removedBuilds = results.reduce((sum, result) => sum + result.removedBuilds, 0);
  if (removedBuilds > 0) {
    context.logger.info({ removedBuilds, ttlDays }, "scheduled build purge complete");
  }
}

/** Say once per timer that the scheduled purge cannot run on this database. */
function warnNoCapability(context: SweepContext, ttlDays: number): void {
  if (context.warned) return;
  context.warned = true;
  context.logger.warn(
    { purgeTtlDays: ttlDays },
    "scheduled build purge is off: this database has no safe build retention (see the System page); run a manual purge where it is supported",
  );
}

function scheduleBranchGc(
  run: () => Promise<void>,
  intervalMs: number,
  onStop: () => void,
): BranchGcTimer {
  const firstDelay = Math.min(3_600_000, intervalMs);
  // oxlint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return -- run catches failures; returning it allows deterministic completion in tests
  const timeout = setTimeout(() => run(), firstDelay);
  timeout.unref?.();

  // oxlint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return -- run catches failures
  const interval = setInterval(() => run(), intervalMs);
  interval.unref?.();

  return {
    stop: () => {
      onStop();
      clearTimeout(timeout);
      clearInterval(interval);
    },
  };
}
