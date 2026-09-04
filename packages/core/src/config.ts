import { z } from "zod";
import type { Logger } from "pino";

import type { AuthAdapter } from "./adapters/auth.ts";
import type { CaptureQueue } from "./adapters/capture-queue.ts";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import type { DatabaseAdapter } from "./adapters/database.ts";
import type { GitHostProvider } from "./adapters/git-host/index.ts";
import type { StorageAdapter } from "./adapters/storage.ts";

/** Brand color theme for the server-rendered UI. */
export interface BrandTheme {
  accent: string;
  surface: { base: string; card: string };
  text: { primary: string; secondary: string };
  border: string;
  status: { approved: string; new: string; rejected: string };
}

/** Branding overrides for the server-rendered UI. */
export interface UIConfig {
  name?: string;
  logo?: string;
  favicon?: string;
  lightTheme?: BrandTheme;
  darkTheme?: BrandTheme;
}

/** A viewport in which stories are captured. */
export interface ShelfViewport {
  name: string;
  width: number;
  height: number;
}

/** Metadata snapshot of a configured adapter. */
export interface AdapterSnapshot {
  name: string;
  version: string;
  description?: string;
  kind: string;
}

/** Shelf-level configuration (validated by {@link shelfConfigSchema}). */
export interface ShelfConfig {
  secret?: string;
  publishedBaseDomain?: string;
  captureConcurrency?: number;
  scratchDir?: string;
  purgeTtlDays?: number;
  viewports?: ShelfViewport[];
  adapters?: Record<string, AdapterSnapshot>;
}

const viewportSchema: z.ZodType<ShelfViewport> = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const brandThemeSchema = z.object({
  accent: z.string(),
  surface: z.object({ base: z.string(), card: z.string() }),
  text: z.object({ primary: z.string(), secondary: z.string() }),
  border: z.string(),
  status: z.object({ approved: z.string(), new: z.string(), rejected: z.string() }),
});

const adapterSnapshotSchema: z.ZodType<AdapterSnapshot> = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  kind: z.string(),
});

/** Zod schema validating the shelf-level configuration. */
export const shelfConfigSchema: z.ZodType<ShelfConfig> = z
  .object({
    secret: z.string().min(1).optional(),
    publishedBaseDomain: z.string().optional(),
    captureConcurrency: z.number().int().positive().optional(),
    scratchDir: z.string().optional(),
    purgeTtlDays: z.number().int().positive().optional(),
    viewports: z.array(viewportSchema).min(1, "at least one viewport required").optional(),
    adapters: z.record(z.string(), adapterSnapshotSchema).optional(),
  })
  .strict();

/** Zod schema validating the UI branding configuration. */
export const uiConfigSchema = z
  .object({
    name: z.string().optional(),
    // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
    logo: z.string().url().optional(),
    // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
    favicon: z.string().url().optional(),
    lightTheme: brandThemeSchema.optional(),
    darkTheme: brandThemeSchema.optional(),
  })
  .strict();

/**
 * Parse and validate a raw shelf-level configuration object.
 *
 * @param config - Unvalidated configuration record.
 * @returns The validated shelf configuration.
 */
export function validateConfig(config: Record<string, unknown>): ShelfConfig {
  const result = shelfConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid ShelfConfig: ${issues}`);
  }
  return result.data;
}

/**
 * Parse and validate a raw UI branding configuration object.
 *
 * @param config - Unvalidated UI configuration record.
 * @returns The validated UI configuration.
 */
export function validateUiConfig(config: Record<string, unknown>): UIConfig {
  const result = uiConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid UIConfig: ${issues}`);
  }
  return result.data;
}

/** Adapter and configuration options for creating the shelf router. */
export interface ShelfOptions {
  database: DatabaseAdapter;
  storage: StorageAdapter;
  captureRunner?: CaptureRunner;
  captureQueue?: CaptureQueue;
  auth?: AuthAdapter;
  gitHosts?: GitHostProvider[];
  logger?: Logger;
  ui?: UIConfig;
  config?: ShelfConfig;
}
