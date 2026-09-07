import type { Logger } from "pino";
import type {
  AdapterInitFailure,
  AdapterInitResult,
  AdapterInitSources,
  HookEntry,
} from "./init.ts";
import type { AdapterInitContext, AdapterLifecycle, AdapterMetadata } from "./metadata.ts";

interface LifecycleCarrier {
  readonly metadata: AdapterMetadata;
  readonly lifecycle?: AdapterLifecycle;
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
