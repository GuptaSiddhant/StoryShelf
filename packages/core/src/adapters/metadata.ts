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

/** Context passed to an adapter's `init` on server startup. */
export interface AdapterInitContext {
  /** Resolved shelf configuration (scratchDir, secret, …). Never log the secret. */
  readonly config: ShelfConfig;
  /** Scoped logger for init-time diagnostics. */
  readonly logger: Logger;
}

/** Result of an adapter's ongoing health probe. */
export interface AdapterHealth {
  /** Whether the adapter is currently usable. */
  readonly ok: boolean;
  /** Probe latency in milliseconds, when measured. */
  readonly latencyMs?: number;
  /** Short human-readable detail (must not contain secrets). */
  readonly detail?: string;
}

/**
 * Optional lifecycle every adapter can expose.
 *
 * Grouped in a sub-object (rather than flattened onto each adapter) so
 * future hooks (`drain?`, `reinit?`, …) land in one place. All hooks must
 * be idempotent — the router may run them more than once per process.
 */
export interface AdapterLifecycle {
  /**
   * One-shot setup: migrations, directory creation, credential validation.
   * Throw when something required is missing.
   */
  init?: (ctx: AdapterInitContext) => Promise<void>;
  /** Teardown: close clients and handles. Must tolerate repeated calls. */
  close?: () => Promise<void>;
  /** Ongoing liveness probe (cheap: SELECT 1, access(), head-bucket). */
  health?: () => Promise<AdapterHealth>;
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
}
