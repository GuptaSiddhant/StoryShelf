/**
 * Adapter metadata: identity, family, and health contracts shared by all adapters.
 */
import type { z } from "zod";
import type { ShelfConfig } from "../config.ts";
import type { Logger } from "../logger.ts";

/**
 * Adapter family — which concern an adapter supplies.
 *
 * Distinct from `kind` (the implementation, e.g. "sqlite" vs "turso"):
 * `category` tells a reader which slot the adapter fills without knowing
 * which adapter instance supplied the metadata.
 */
export type AdapterCategory =
  | "database"
  | "storage"
  | "auth"
  | "capture-runner"
  | "capture-queue"
  | "git-host";

/** Common adapter identity — every adapter instance exposes this. */
export interface AdapterMetadata {
  /** Human label for UI/logs. */
  readonly name: string;
  /** Package version injected at build via __PKG_VERSION__. */
  readonly version: string;
  /** Optional short description. */
  readonly description?: string;
  /** Machine key for the implementation (e.g. "sqlite", "local", "s3", "oauth", "playwright"). */
  readonly kind: string;
  /** Adapter family — which concern this adapter supplies. */
  readonly category: AdapterCategory;
}

/** Git-specific metadata extension (adds logo + validation schema). */
export interface GitAdapterMetadata extends AdapterMetadata {
  readonly category: "git-host";
  readonly logo?: string;
  readonly schema: z.ZodType;
}

/** Context passed to an adapter's `setup` on server startup. */
export interface AdapterSetupContext {
  /** Resolved shelf configuration (scratchDir, secret, …). Never log the secret. */
  readonly config: ShelfConfig;
  /** Scoped logger for setup-time diagnostics. */
  readonly logger: Logger;
}

/** Result of an adapter's ongoing health probe. */
export interface AdapterHealth {
  /** Whether the adapter is currently usable. */
  readonly ok: boolean;
  /** Short human-readable detail (must not contain secrets). */
  readonly detail?: string;
}

/**
 * Optional lifecycle every adapter can expose — all or nothing.
 *
 * An adapter either omits `lifecycle` entirely or implements all three
 * hooks; partial implementations are not allowed. Grouped in a sub-object
 * (rather than flattened onto each adapter) so future hooks land in one
 * place. All hooks must be idempotent — the router may run them more than
 * once per process.
 */
export interface AdapterLifecycle {
  /**
   * One-shot setup: migrations, directory creation, credential validation.
   * Throw when something required is missing.
   */
  setup: (ctx: AdapterSetupContext) => Promise<void>;
  /** Teardown: destroy clients and handles. Must tolerate repeated calls. */
  teardown: () => Promise<void>;
  /** Ongoing liveness probe (cheap: SELECT 1, access(), head-bucket). */
  health: () => Promise<AdapterHealth>;
}

/**
 * Shared adapter base.
 *
 * Every adapter interface extends this (narrowing `category` via `Extra`)
 * instead of redeclaring `metadata`. `kind` stays an open string so
 * third-party implementations are never blocked by a closed union.
 */
export interface Adapter<Extra extends object = Record<string, unknown>> {
  /** Adapter identity (mandatory). */
  readonly metadata: AdapterMetadata & Extra;
  /** Optional lifecycle hooks. */
  readonly lifecycle?: AdapterLifecycle;
  /**
   * Bind the host-owned runtime logger. Called by the app/worker when
   * present; factories must never create their own loggers — they only
   * store what they are given (explicit `options.logger` wins over bound).
   */
  setLogger?(logger: Logger): void;
}
