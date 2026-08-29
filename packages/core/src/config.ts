import type { Logger } from "pino";

import type { AuthAdapter } from "./adapters/auth.ts";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import type { DatabaseAdapter } from "./adapters/database.ts";
import type { StatusAdapter } from "./adapters/status.ts";
import type { StorageAdapter } from "./adapters/storage.ts";
import type { Viewport } from "./capture/adapter.ts";

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

/** Runtime configuration passed to the shelf router. */
export interface ShelfConfig {
  /** Session signing secret. */
  secret?: string;
  /** Domain used for published Storybook URLs. */
  publishedBaseDomain?: string;
  /** Number of concurrent capture jobs. */
  captureConcurrency?: number;
  /** Days after which builds are purged. */
  purgeTtlDays?: number;
  /** Viewports at which stories are captured. */
  viewports?: Viewport[];
}

/** Options used to construct a shelf router. */
export interface ShelfOptions {
  /** Database adapter. */
  database: DatabaseAdapter;
  /** Storage adapter. */
  storage: StorageAdapter;
  /** Capture runner for asynchronous builds. */
  capture?: CaptureRunner;
  /** Authentication adapter. */
  auth?: AuthAdapter;
  /** Git provider status adapter. */
  status?: StatusAdapter;
  /** Logger override. If omitted, a pino logger is constructed internally. */
  logger?: Logger;
  /** UI branding configuration. */
  ui?: UIConfig;
  /** Runtime configuration. */
  config?: ShelfConfig;
}
