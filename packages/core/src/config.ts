import { z } from "zod";
import type { Logger } from "pino";

import type { AuthAdapter } from "./adapters/auth.ts";
import type { CaptureQueue } from "./adapters/capture-queue.ts";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import type { DatabaseAdapter } from "./adapters/database.ts";
import type { GitProvider } from "./adapters/status.ts";
import type { StorageAdapter } from "./adapters/storage.ts";

/** Branding colors used to theme the web UI. */
export interface BrandTheme {
  /** Accent color. */
  accent: string;
  /** Surface colors. */
  surface: { base: string; card: string };
  /** Text colors. */
  text: { primary: string; secondary: string };
  /** Border color. */
  border: string;
  /** Status-specific colors. */
  status: { approved: string; new: string; rejected: string };
}

/** Branding and theme configuration for the web UI. */
export interface UIConfig {
  /** Brand name shown in the UI. */
  name?: string;
  /** URL to a logo image. */
  logo?: string;
  /** URL to a favicon. */
  favicon?: string;
  /** Theme used in light mode. */
  lightTheme?: BrandTheme;
  /** Theme used in dark mode. */
  darkTheme?: BrandTheme;
}

const viewportSchema = z.object({
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

export const shelfConfigSchema = z
  .object({
    secret: z.string().min(1).optional(),
    publishedBaseDomain: z.string().optional(),
    captureConcurrency: z.number().int().positive().optional(),
    scratchDir: z.string().optional(),
    purgeTtlDays: z.number().int().positive().optional(),
    viewports: z.array(viewportSchema).min(1, "at least one viewport required").optional(),
  })
  .strict();

export const uiConfigSchema = z
  .object({
    name: z.string().optional(),
    logo: z.url().optional(),
    favicon: z.url().optional(),
    lightTheme: brandThemeSchema.optional(),
    darkTheme: brandThemeSchema.optional(),
  })
  .strict();

/** Runtime configuration passed to the shelf router. */
export type ShelfConfig = z.infer<typeof shelfConfigSchema>;

export function validateConfig(config: Record<string, unknown>): ShelfConfig {
  const result = shelfConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid ShelfConfig: ${issues}`);
  }
  return result.data;
}

export function validateUiConfig(config: Record<string, unknown>): UIConfig {
  const result = uiConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid UIConfig: ${issues}`);
  }
  return result.data;
}

/** Options used to construct a shelf router. */
export interface ShelfOptions {
  /** Database adapter. */
  database: DatabaseAdapter;
  /** Storage adapter. */
  storage: StorageAdapter;
  /** Capture runner for asynchronous builds. */
  captureRunner?: CaptureRunner;
  /**
   * Capture queue. Defaults to an in-process queue on long-lived hosts; supply
   * a remote queue (SQS, Workers Queues, Azure Storage Queues) with a separate
   * worker to run capture on serverless runtimes.
   */
  captureQueue?: CaptureQueue;
  /** Authentication adapter. */
  auth?: AuthAdapter;
  /** Git provider integrations (array — one per integration, fanout per build). */
  gitProviders?: GitProvider[];
  /** Logger override. If omitted, a pino logger is constructed internally. */
  logger?: Logger;
  /** UI branding configuration. */
  ui?: UIConfig;
  /** Runtime configuration. */
  config?: ShelfConfig;
}
