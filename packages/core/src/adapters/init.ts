/**
 * Adapter lifecycle runner: collect and execute `init`/`close` hooks.
 *
 * `createShelfRouter` kicks `init` eagerly via `Promise.allSettled` (so one
 * slow adapter never starves the others) and gates the first request on the
 * shared result. `app.lifecycle.init()` re-runs for fail-fast startup;
 * `app.lifecycle.close()` fans out teardown. All hooks must be idempotent.
 */
import type { Logger } from "pino";
import type { AuthAdapter } from "./auth.ts";
import type { CaptureQueue } from "./capture-queue.ts";
import type { CaptureRunner } from "./capture-runner.ts";
import type { DatabaseAdapter } from "./database.ts";
import type { GitHostProvider } from "./git-host/index.ts";
import type { AdapterInitContext, AdapterLifecycle, AdapterMetadata } from "./metadata.ts";
import type { StorageAdapter } from "./storage.ts";

/** Adapters that can take part in lifecycle runs. */
export interface AdapterInitSources {
  database: DatabaseAdapter;
  storage: StorageAdapter;
  captureRunner?: CaptureRunner;
  captureQueue?: CaptureQueue;
  auth?: AuthAdapter;
  gitHosts?: GitHostProvider[];
}

interface LifecycleCarrier {
  readonly metadata: AdapterMetadata;
  readonly lifecycle?: AdapterLifecycle;
}

/** One collected hook bound to its adapter identity. */
export interface HookEntry {
  readonly category: string;
  readonly kind: string;
  readonly name: string;
  readonly run: (ctx: AdapterInitContext) => Promise<void>;
}

/** One failed hook, with its adapter identity attached. */
export interface AdapterInitFailure {
  readonly category: string;
  readonly kind: string;
  readonly name: string;
  readonly error: string;
}

/** Settled outcome of a lifecycle run (never rejects — use `ok`). */
export interface AdapterInitResult {
  readonly ok: boolean;
  readonly failures: AdapterInitFailure[];
}

/** Lifecycle phase a run covers. */
export type LifecyclePhase = "init" | "close";

/** Thrown when an `app.lifecycle.init()` or `close()` run has failures. */
export class AdapterLifecycleError extends Error {
  readonly phase: LifecyclePhase;
  readonly failures: AdapterInitFailure[];
  constructor(phase: LifecyclePhase, failures: AdapterInitFailure[]) {
    super(`Adapter ${phase} failed: ${failures.map((f) => `${f.category}/${f.kind}`).join(", ")}`);
    this.name = "AdapterLifecycleError";
    this.phase = phase;
    this.failures = failures;
  }
}

function hookEntry(adapter: LifecycleCarrier, hook: "init" | "close"): HookEntry | null {
  const fn = adapter.lifecycle?.[hook];
  if (!fn) {
    return null;
  }
  const { category, kind, name } = adapter.metadata;
  return {
    category,
    kind,
    name,
    run: async (ctx) => {
      await fn(ctx);
    },
  };
}

function pushHook(
  entries: HookEntry[],
  adapter: LifecycleCarrier | undefined,
  hook: "init" | "close",
): void {
  if (!adapter) {
    return;
  }
  const entry = hookEntry(adapter, hook);
  if (entry) {
    entries.push(entry);
  }
}

function pushAll(entries: HookEntry[], sources: AdapterInitSources, hook: "init" | "close"): void {
  pushHook(entries, sources.database, hook);
  pushHook(entries, sources.storage, hook);
  pushHook(entries, sources.captureRunner, hook);
  pushHook(entries, sources.captureQueue, hook);
  pushHook(entries, sources.auth, hook);
  for (const provider of sources.gitHosts ?? []) {
    pushHook(entries, provider, hook);
  }
}

/** Collect every available `init` hook in deterministic order. */
export function collectInits(sources: AdapterInitSources): HookEntry[] {
  const entries: HookEntry[] = [];
  pushAll(entries, sources, "init");
  return entries;
}

/** Collect every available `close` hook in deterministic order. */
export function collectCloses(sources: AdapterInitSources): HookEntry[] {
  const entries: HookEntry[] = [];
  pushAll(entries, sources, "close");
  return entries;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function toFailure(entry: HookEntry, reason: unknown): AdapterInitFailure {
  return { category: entry.category, kind: entry.kind, name: entry.name, error: messageOf(reason) };
}

function toResult(
  entries: HookEntry[],
  outcomes: PromiseSettledResult<void>[],
  logger: Logger,
  verb: string,
): AdapterInitResult {
  const failures: AdapterInitFailure[] = [];
  for (const [index, entry] of entries.entries()) {
    const outcome: PromiseSettledResult<void> | undefined = outcomes[index];
    if (outcome?.status === "rejected") {
      failures.push(toFailure(entry, outcome.reason));
    }
  }
  if (failures.length > 0) {
    logger.error({ failures }, `adapter ${verb} failed`);
  } else {
    logger.info({ count: entries.length }, `adapters ${verb}d`);
  }
  return { ok: failures.length === 0, failures };
}

/** Run init hooks concurrently; failures are collected, never thrown. */
export async function runAdapterInits(
  entries: HookEntry[],
  ctx: AdapterInitContext,
  logger: Logger,
): Promise<AdapterInitResult> {
  const outcomes = await Promise.allSettled(
    entries.map(async (entry) => {
      await entry.run(ctx);
    }),
  );
  return toResult(entries, outcomes, logger, "init");
}

/** Run close hooks concurrently; failures are collected, never thrown. */
export async function runAdapterCloses(
  entries: HookEntry[],
  ctx: AdapterInitContext,
  logger: Logger,
): Promise<AdapterInitResult> {
  const outcomes = await Promise.allSettled(
    entries.map(async (entry) => {
      await entry.run(ctx);
    }),
  );
  return toResult(entries, outcomes, logger, "close");
}
