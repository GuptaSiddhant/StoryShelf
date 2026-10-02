import type { Logger } from "pino";
import { sanitizeErrorText } from "../utils/redact.ts";
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
    ...(sources.gitHosts ?? []),
  ];
  for (const adapter of adapters) {
    adapter?.setLogger?.(logger.child({ component: adapter.metadata.kind }));
  }
}

function messageOf(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  return sanitizeErrorText(text, 500);
}

/** Budgets that trigger slow-hook warnings (observe only, never abort). */
const SLOW_SETUP_MS = 10_000;
const SLOW_TEARDOWN_MS = 5_000;

/** Run one hook with start/done logging and a slow-hook warning. */
async function runHook(
  entry: HookEntry,
  ctx: AdapterSetupContext,
  logger: Logger,
  slowMs: number,
): Promise<void> {
  const { category, kind, name } = entry;
  const started = Date.now();
  logger.info({ category, kind, name }, "adapter hook start");
  try {
    await entry.run(ctx);
  } finally {
    const durationMs = Date.now() - started;
    logger.info({ category, kind, name, durationMs }, "adapter hook done");
    if (durationMs > slowMs) {
      logger.warn({ category, kind, name, durationMs, slowMs }, "slow adapter hook");
    }
  }
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

/** One run of collected hooks with start/done logging and hung visibility. */
async function runHooks(
  entries: HookEntry[],
  ctx: AdapterSetupContext,
  logger: Logger,
  verb: string,
  slowMs: number,
): Promise<AdapterSetupResult> {
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) {
      logger.warn({ count: entries.length, slowMs }, `adapters ${verb} still running`);
    }
  }, slowMs);
  timer.unref?.();
  try {
    const outcomes = await Promise.allSettled(
      entries.map(async (entry) => {
        await runHook(entry, ctx, logger, slowMs);
      }),
    );
    return toResult(entries, outcomes, logger, verb);
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

/** Run setup hooks concurrently; failures are collected, never thrown. */
export async function runAdapterSetups(
  entries: HookEntry[],
  ctx: AdapterSetupContext,
  logger: Logger,
): Promise<AdapterSetupResult> {
  return await runHooks(entries, ctx, logger, "setup", SLOW_SETUP_MS);
}

/** Run teardown hooks concurrently; failures are collected, never thrown. */
export async function runAdapterTeardowns(
  entries: HookEntry[],
  ctx: AdapterSetupContext,
  logger: Logger,
): Promise<AdapterSetupResult> {
  return await runHooks(entries, ctx, logger, "teardown", SLOW_TEARDOWN_MS);
}
