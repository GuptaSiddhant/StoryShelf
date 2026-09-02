import type { z } from "zod";

/** Common adapter identity — every adapter instance exposes this. */
export interface AdapterMetadata {
  /** Human label for UI/logs. */
  readonly name: string;
  /** Package version injected at build via __PKG_VERSION__. */
  readonly version: string;
  /** Optional short description. */
  readonly description?: string;
  /** Machine key (e.g. "github", "sqlite", "local", "s3", "password", "oauth", "playwright", "sqs", "memory"). */
  readonly kind: string;
}

/** Git-specific metadata extension (adds logo + validation schema). */
export interface GitAdapterMetadata extends AdapterMetadata {
  readonly kind: string;
  readonly logo?: string;
  readonly schema: z.ZodType;
}
