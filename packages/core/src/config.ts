import { z } from "zod";
import type { Logger } from "pino";

import type { AuthAdapter } from "./adapters/auth.ts";
import type { CaptureQueue } from "./adapters/capture-queue.ts";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import type { DatabaseAdapter } from "./adapters/database.ts";
import type { GitHostProvider } from "./adapters/git-host/index.ts";
import type { StorageAdapter } from "./adapters/storage.ts";

export interface BrandTheme {
  accent: string;
  surface: { base: string; card: string };
  text: { primary: string; secondary: string };
  border: string;
  status: { approved: string; new: string; rejected: string };
}

export interface UIConfig {
  name?: string;
  logo?: string;
  favicon?: string;
  lightTheme?: BrandTheme;
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

const adapterSnapshotSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  kind: z.string(),
});

export const shelfConfigSchema = z
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

export const uiConfigSchema = z
  .object({
    name: z.string().optional(),
    logo: z.string().url().optional(),
    favicon: z.string().url().optional(),
    lightTheme: brandThemeSchema.optional(),
    darkTheme: brandThemeSchema.optional(),
  })
  .strict();

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
