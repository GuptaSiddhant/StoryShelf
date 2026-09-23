/**
 * Adapter lifecycle contract: hooks every adapter can expose, plus the
 * settled-result and error types. The runner (`setup-runner.ts`) collects
 * and executes the hooks; `createShelfApp` kicks `setup` eagerly and
 * gates the first request on the shared result. All hooks must be
 * idempotent.
 */
import type { AuthAdapter } from "./auth.ts";
import type { CaptureQueue } from "./capture-queue.ts";
import type { CaptureRunner } from "./capture-runner.ts";
import type { DatabaseAdapter } from "./database.ts";
import type { GitHostProvider } from "./git-host/index.ts";
import type { AdapterSetupContext } from "./metadata.ts";
import type { StorageAdapter } from "./storage.ts";

/** Adapters that can take part in lifecycle runs. */
export interface AdapterSetupSources {
  database: DatabaseAdapter;
  storage: StorageAdapter;
  captureRunner?: CaptureRunner;
  captureQueue?: CaptureQueue;
  auth?: AuthAdapter;
  gitHosts?: GitHostProvider[];
}

/** One collected hook bound to its adapter identity. */
export interface HookEntry {
  readonly category: string;
  readonly kind: string;
  readonly name: string;
  readonly run: (ctx: AdapterSetupContext) => Promise<void>;
}

/** One failed hook, with its adapter identity attached. */
export interface AdapterSetupFailure {
  readonly category: string;
  readonly kind: string;
  readonly name: string;
  readonly error: string;
}

/** Settled outcome of a lifecycle run (never rejects — use `ok`). */
export interface AdapterSetupResult {
  readonly ok: boolean;
  readonly failures: AdapterSetupFailure[];
}

/** Lifecycle phase a run covers. */
export type LifecyclePhase = "setup" | "teardown";

/**
 * Thrown when an `app.lifecycle.setup()` or `teardown()` run finishes with failures.
 *
 * Inspect `phase` to know which hook failed and `failures` for per-adapter
 * diagnostics. The router converts this into a 500 with structured details
 * during health checks.
 */
export class AdapterLifecycleError extends Error {
  /** Which lifecycle phase failed (`setup` or `teardown`). */
  readonly phase: LifecyclePhase;
  /** One entry per adapter hook that failed. */
  readonly failures: AdapterSetupFailure[];
  constructor(phase: LifecyclePhase, failures: AdapterSetupFailure[]) {
    super(`Adapter ${phase} failed: ${failures.map((f) => `${f.category}/${f.kind}`).join(", ")}`);
    this.name = "AdapterLifecycleError";
    this.phase = phase;
    this.failures = failures;
  }
}

/** Collect every `setup` hook from the configured adapters. */
export {
  bindAdapterLoggers,
  collectSetups,
  collectTeardowns,
  runAdapterSetups,
  runAdapterTeardowns,
} from "./setup-runner.ts";
