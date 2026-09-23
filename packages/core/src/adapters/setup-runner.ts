import type { Logger } from "pino";
import type { AdapterLifecycle, AdapterMetadata, AdapterSetupContext } from "./metadata.ts";
import type {
  AdapterSetupFailure,
  AdapterSetupResult,
  AdapterSetupSources,
  HookEntry,
} from "./setup.ts";

interface LifecycleCarrier {
  readonly metadata: AdapterMetadata;
  readonly lifecycle?: AdapterLifecycle;
}

function hookEntry(adapter: LifecycleCarrier, hook: "setup" | "teardown"): HookEntry | null {
  const lifecycle = adapter.lifecycle;
  if (!lifecycle) {
    return null;
  }
  const fn = lifecycle[hook];
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
  hook: "setup" | "teardown",
): void {
  if (!adapter) {
    return;
  }
  const entry = hookEntry(adapter, hook);
  if (entry) {
    entries.push(entry);
  }
}

function pushAll(
  entries: HookEntry[],
  sources: AdapterSetupSources,
  hook: "setup" | "teardown",
): void {
  pushHook(entries, sources.database, hook);
  pushHook(entries, sources.storage, hook);
  pushHook(entries, sources.captureRunner, hook);
  pushHook(entries, sources.captureQueue, hook);
  pushHook(entries, sources.auth, hook);
  for (const provider of sources.gitHosts ?? []) {
    pushHook(entries, provider, hook);
  }
}

/** Collect every available `setup` hook in deterministic order. */
export function collectSetups(sources: AdapterSetupSources): HookEntry[] {
  const entries: HookEntry[] = [];
  pushAll(entries, sources, "setup");
  return entries;
}

/** Collect every available `teardown` hook in deterministic order. */
export function collectTeardowns(sources: AdapterSetupSources): HookEntry[] {
  const entries: HookEntry[] = [];
  pushAll(entries, sources, "teardown");
  return entries;
}

interface LoggerCarrier {
  readonly metadata: AdapterMetadata;
  readonly setLogger?: (logger: Logger) => void;
}

/**
 * Bind the host logger on every adapter that accepts one, scoped by kind.
 * Adapters without `setLogger` keep today's behavior (silent when no
 * explicit `options.logger` was passed at construction).
 */
export function bindAdapterLoggers(sources: AdapterSetupSources, logger: Logger): void {
  const adapters: ReadonlyArray<LoggerCarrier | undefined> = [
    sources.database,
    sources.storage,
    sources.captureRunner,
    sources.captureQueue,
    sources.auth,
    ...(sources.gitHosts ?? []),
  ];
  for (const adapter of adapters) {
    adapter?.setLogger?.(logger.child({ component: adapter.metadata.kind }));
  }
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function toFailure(entry: HookEntry, reason: unknown): AdapterSetupFailure {
  return { category: entry.category, kind: entry.kind, name: entry.name, error: messageOf(reason) };
}

function toResult(
  entries: HookEntry[],
  outcomes: PromiseSettledResult<void>[],
  logger: Logger,
  verb: string,
): AdapterSetupResult {
  const failures: AdapterSetupFailure[] = [];
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

/** Run setup hooks concurrently; failures are collected, never thrown. */
export async function runAdapterSetups(
  entries: HookEntry[],
  ctx: AdapterSetupContext,
  logger: Logger,
): Promise<AdapterSetupResult> {
  const outcomes = await Promise.allSettled(
    entries.map(async (entry) => {
      await entry.run(ctx);
    }),
  );
  return toResult(entries, outcomes, logger, "setup");
}

/** Run teardown hooks concurrently; failures are collected, never thrown. */
export async function runAdapterTeardowns(
  entries: HookEntry[],
  ctx: AdapterSetupContext,
  logger: Logger,
): Promise<AdapterSetupResult> {
  const outcomes = await Promise.allSettled(
    entries.map(async (entry) => {
      await entry.run(ctx);
    }),
  );
  return toResult(entries, outcomes, logger, "teardown");
}
