/**
 * Adapter lifecycle contract: hooks every adapter can expose, plus the
 * settled-result and error types. The runner (`setup-runner.ts`) collects
 * and executes the hooks; `createShelfApp` kicks `setup` eagerly and
 * gates the first request on the shared result. All hooks must be
 * idempotent.
 */
import type { CaptureRunner } from "./capture-runner.ts";
import type { DatabaseAdapter } from "./database.ts";
import type { DesignProvider } from "./design.ts";
import type { EmailSender } from "./email-sender.ts";
import type { AdapterSetupContext } from "./metadata.ts";
import type { NotifierProvider } from "./notifier/provider.ts";
import type { StorageAdapter } from "./storage.ts";

/** Adapters that can take part in lifecycle runs. */
export interface AdapterSetupSources {
  database: DatabaseAdapter;
  storage: StorageAdapter;
  captureRunner?: CaptureRunner;
  design?: DesignProvider[];
  notifiers?: NotifierProvider[];
  emailSender?: EmailSender;
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
  /**
   * With `described`, the message says what is wrong with each adapter, not only which ones: for
   * failures found by boot validation, whose text is about the adapter's shape and never about a
   * runtime error (which stays in `failures`).
   */
  constructor(phase: LifecyclePhase, failures: AdapterSetupFailure[], described = false) {
    const names = failures.map((f) => `${f.category}/${f.kind}`);
    super(
      described
        ? `Adapter ${phase} failed: ${failures.map((f) => `${f.category}/${f.kind}: ${f.error}`).join("; ")}`
        : `Adapter ${phase} failed: ${names.join(", ")}`,
    );
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

/** Boot-time shape validation for third-party adapters. */
export {
  validateAdapter,
  validateAdapterSources,
  validateAuth,
  validateBootAssembly,
} from "./validate.ts";
export { adapterSourcesOf } from "./sources.ts";
