/**
 * Adapter lifecycle contract: hooks every adapter can expose, plus the
 * settled-result and error types. The runner (`init-runner.ts`) collects
 * and executes the hooks; `createShelfRouter` kicks `init` eagerly and
 * gates the first request on the shared result. All hooks must be
 * idempotent.
 */
import type { AuthAdapter } from "./auth.ts";
import type { CaptureQueue } from "./capture-queue.ts";
import type { CaptureRunner } from "./capture-runner.ts";
import type { DatabaseAdapter } from "./database.ts";
import type { GitHostProvider } from "./git-host/index.ts";
import type { AdapterInitContext } from "./metadata.ts";
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

export { collectCloses, collectInits, runAdapterCloses, runAdapterInits } from "./init-runner.ts";
