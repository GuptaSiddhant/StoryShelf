import type { AuthAdapter } from "./adapters/auth.ts";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import type { DatabaseAdapter } from "./adapters/database.ts";
import type { LoggerAdapter } from "./adapters/logger.ts";
import type { StatusAdapter } from "./adapters/status.ts";
import type { StorageAdapter } from "./adapters/storage.ts";
import type { Viewport } from "./capture/adapter.ts";

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

export interface ShelfConfig {
  secret?: string;
  publishedBaseDomain?: string;
  captureConcurrency?: number;
  purgeTtlDays?: number;
  viewports?: Viewport[];
}

export interface ShelfOptions {
  database: DatabaseAdapter;
  storage: StorageAdapter;
  capture?: CaptureRunner;
  auth?: AuthAdapter;
  status?: StatusAdapter;
  logger?: LoggerAdapter;
  ui?: UIConfig;
  config?: ShelfConfig;
}
