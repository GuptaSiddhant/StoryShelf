import type { Logger } from "pino";
import { z } from "zod";
import type { PollableCaptureQueue } from "./adapters/capture-queue.ts";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import type { DatabaseAdapter } from "./adapters/database.ts";
import type { DesignProvider } from "./adapters/design.ts";
import type { EmailSender } from "./adapters/email-sender.ts";
import type { AdapterCategory } from "./adapters/metadata.ts";
import type { NotifierProvider } from "./adapters/notifier/provider.ts";
import type { StorageAdapter } from "./adapters/storage.ts";
import type { Ai } from "./ai.ts";
import type { Auth } from "./auth.ts";

/** Brand color theme for the server-rendered UI. */
export interface BrandTheme {
  accent: string;
  accentContrast?: string;
  ring?: string;
  surface: { base: string; card: string; muted?: string; subtle?: string };
  text: { primary: string; secondary: string; muted?: string };
  border: string;
  borderSubtle?: string;
  status: { approved: string; new: string; rejected: string };
  sidebarBg?: string;
  topbarBg?: string;
  radius?: string;
  radiusSm?: string;
  shadow?: string;
}

/** Text overrides for the auth (login) UI. */
export interface AuthUiConfig {
  /** Page title, default "Sign in". */
  title?: string;
  /** Optional subtitle under the title. */
  subtitle?: string;
  /** Password field label, default "Password". */
  passwordLabel?: string;
  /** Password field placeholder. */
  passwordPlaceholder?: string;
  /** Submit button label, default "Sign in". */
  submitLabel?: string;
  /**
   * Template for SSO buttons, default "Sign in with {label}".
   * Must contain "{label}" which is replaced with the provider label.
   */
  ssoLabelTemplate?: string;
  /** Help text shown under the form. */
  helpText?: string;
  /** Footer text shown at the bottom of the card. */
  footerText?: string;
}

/** Branding overrides for the server-rendered UI. */
export interface UIConfig {
  name?: string;
  logo?: string;
  /**
   * @deprecated Ignored. The favicon is the product's own mark, served by the
   * app itself; set `logo` to rebrand the sidebar instead.
   */
  favicon?: string;
  lightTheme?: BrandTheme;
  darkTheme?: BrandTheme;
  auth?: AuthUiConfig;
}

/** Default cap for a single Storybook zip upload (1 GiB). */
export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

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
  category: AdapterCategory;
}

/** Site-wide notification defaults (brand + sender identity for admin alerts). */
export interface NotificationsConfig {
  fromEmail?: string;
  fromName?: string;
  footerText?: string;
  slackUsername?: string;
}
/** Shelf-level configuration (validated by {@link shelfConfigSchema}). */
export interface ShelfConfig {
  secret?: string;
  /**
   * The secret `secret` replaced. Used only to decrypt stored credentials
   * (webhook, git-token, and notification secrets) written before a rotation;
   * new writes always use `secret`. Remove once credentials are re-encrypted.
   */
  previousSecret?: string;
  /**
   * Re-encrypt credentials still under `previousSecret` at boot. Default false:
   * site admins can run it from the System page instead. No effect without
   * `previousSecret`.
   */
  migrateCredentialsOnBoot?: boolean;
  /**
   * Bootstrap site-admin bearer token (`STORYSHELF_ADMIN_TOKEN`/`ADMIN_TOKEN`).
   * Grants site-admin API access when no admin user exists yet; never
   * mint sessions from it. Distinct from `secret` (session signing).
   */
  adminToken?: string;
  publishedBaseDomain?: string;
  /**
   * Public base URL of this deployment (e.g. `https://shelf.example.com`).
   * Used as the issuer in the `/.well-known/openid-configuration` relying-party
   * helper document; falls back to the request origin when unset.
   */
  publicBaseUrl?: string;
  /**
   * Working directory for capture and inline statics extraction. Defaults to
   * `<os.tmpdir()>/storyshelf`; publishing and capture extract there.
   */
  scratchDir?: string;
  purgeTtlDays?: number;
  /** Branch baseline TTL, days; null disables branch GC (default 30). */
  branchTtlDays?: number | null;
  /** Branch GC interval, ms; daily sweep via interval clock (default 86_400_000). */
  branchGcIntervalMs?: number;
  maxUploadBytes?: number;
  /**
   * Emit `Server-Timing` response headers (total + db/storage roll-ups).
   * Opt-in, off by default — some deployments prefer no timing headers.
   */
  serverTiming?: boolean;
  /**
   * Largest zip (bytes) extracted inline in the upload request; a larger zip is published by a
   * `publish` job (or refused with 413 on a host that runs no consumer). The count is taken
   * while the upload streams, never from `Content-Length`. Default 50 MB; `0` sends every zip to
   * a `publish` job.
   */
  maxInlineUnzipSize?: number;
  /** Most entries an uploaded Storybook zip may hold (default 50 000); more fails the publish. */
  maxZipEntries?: number;
  /**
   * Most uncompressed bytes an uploaded Storybook zip may expand to (default 2 GiB), counted while
   * extracting; more fails the publish. The compressed size is no bound on its own.
   */
  maxUnzippedBytes?: number;
  viewports?: ShelfViewport[];
  adapters?: Record<string, AdapterSnapshot>;
}

const viewportSchema: z.ZodType<ShelfViewport> = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const brandThemeSchema: z.ZodType<BrandTheme> = z.object({
  accent: z.string(),
  accentContrast: z.string().optional(),
  ring: z.string().optional(),
  surface: z.object({
    base: z.string(),
    card: z.string(),
    muted: z.string().optional(),
    subtle: z.string().optional(),
  }),
  text: z.object({ primary: z.string(), secondary: z.string(), muted: z.string().optional() }),
  border: z.string(),
  borderSubtle: z.string().optional(),
  status: z.object({ approved: z.string(), new: z.string(), rejected: z.string() }),
  sidebarBg: z.string().optional(),
  topbarBg: z.string().optional(),
  radius: z.string().optional(),
  radiusSm: z.string().optional(),
  shadow: z.string().optional(),
});

const adapterSnapshotSchema: z.ZodType<AdapterSnapshot> = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  kind: z.string(),
  category: z.enum([
    "database",
    "storage",
    "capture-runner",
    "capture-queue",
    "design",
    "notifier",
  ]),
});

const authUiConfigSchema: z.ZodType<AuthUiConfig> = z.object({
  title: z.string().min(1).optional(),
  subtitle: z.string().optional(),
  passwordLabel: z.string().min(1).optional(),
  passwordPlaceholder: z.string().optional(),
  submitLabel: z.string().min(1).optional(),
  ssoLabelTemplate: z.string().min(1).optional(),
  helpText: z.string().optional(),
  footerText: z.string().optional(),
});

/** Zod schema validating `notifications.config`. */
export const notificationsConfigSchema: z.ZodType<NotificationsConfig> = z.object({
  fromEmail: z.string().min(1).optional(),
  fromName: z.string().min(1).optional(),
  footerText: z.string().min(1).optional(),
  slackUsername: z.string().min(1).optional(),
});

/** Zod schema validating the shelf-level configuration. */
export const shelfConfigSchema: z.ZodType<ShelfConfig> = z
  .object({
    secret: z.string().min(1).optional(),
    previousSecret: z.string().min(1).optional(),
    migrateCredentialsOnBoot: z.boolean().optional(),
    adminToken: z.string().min(1).optional(),
    publishedBaseDomain: z.string().optional(),
    // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
    publicBaseUrl: z.string().url().optional(),
    scratchDir: z.string().optional(),
    purgeTtlDays: z.number().int().positive().optional(),
    branchTtlDays: z.number().int().positive().nullable().optional(),
    branchGcIntervalMs: z.number().int().positive().optional(),
    maxUploadBytes: z.number().int().positive().optional(),
    serverTiming: z.boolean().optional(),
    maxInlineUnzipSize: z.number().int().min(0).optional(),
    maxZipEntries: z.number().int().positive().optional(),
    maxUnzippedBytes: z.number().int().positive().optional(),
    viewports: z.array(viewportSchema).min(1, "at least one viewport required").optional(),
    adapters: z.record(z.string(), adapterSnapshotSchema).optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.previousSecret !== undefined && config.secret === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["previousSecret"],
        message: "previousSecret requires secret",
      });
    }
    if (config.previousSecret !== undefined && config.previousSecret === config.secret) {
      ctx.addIssue({
        code: "custom",
        path: ["previousSecret"],
        message: "previousSecret must differ from secret",
      });
    }
  });

/** Zod schema validating the UI branding configuration. */
export const uiConfigSchema: z.ZodType<UIConfig> = z
  .object({
    name: z.string().optional(),
    // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
    logo: z.string().url().optional(),
    // Accepted but ignored (see UIConfig.favicon) so existing configs keep
    // validating under .strict().
    // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
    favicon: z.string().url().optional(),
    lightTheme: brandThemeSchema.optional(),
    darkTheme: brandThemeSchema.optional(),
    auth: authUiConfigSchema.optional(),
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

/** Testing options: what renders, how jobs are queued, how many run at once, and how screenshots are compared. */
export interface ShelfTestingOptions {
  /**
   * Pure renderer. Required unless `queue` is set: with a user-supplied queue a remote consumer
   * may render instead, so this process does not.
   */
  runner?: CaptureRunner;
  /**
   * Replaces the database queue for `capture` jobs (ADR 0006, decision 6). With `runner` it is
   * consumed by this instance like the database queue; without one it is enqueue-only and
   * something else consumes it. Publish jobs stay on the database queue.
   */
  queue?: PollableCaptureQueue;
  /** Jobs this instance runs at once; auto-sized from CPU and memory when unset. */
  concurrency?: number;
  /**
   * Retries after a first failed attempt before a capture job fails for good (default 2: three
   * attempts). One limit covers failed attempts, lost leases and forked-child crashes.
   */
  retries?: number;
  /**
   * Module run in a forked capture child (it calls `runCaptureChild` from `@storyshelf/core/capture`).
   * The app consumes the queue and pushes each job to the child over IPC. Needs `runner`, which
   * serves as the in-process fallback.
   */
  workerEntry?: string;
  /**
   * Split a big build across the queue: captures (story x viewport x engine) per shard. A build of
   * up to twice this size still renders in one piece. Unset keeps every build in one job. Needs
   * `runner`. With `workerEntry` the forked child plans and renders shards and puts them on the
   * database queue itself.
   */
  shardSize?: number;
  /**
   * Where captures run. `auto` (default) forks when `workerEntry` is set and the host can afford
   * a second process; `in-process` never forks; `fork` forks regardless of the host and fails at
   * boot if it cannot.
   */
  mode?: "auto" | "in-process" | "fork";
  /** Screenshot comparison, shared by capture and the re-diff endpoint. */
  compare?: ShelfCompareOptions;
  /** Image library selection; see {@link ShelfImagesOptions}. */
  images?: ShelfImagesOptions;
}

/** Notification options: who can deliver, over which transport, with what branding. */
export interface ShelfNotificationsOptions {
  /** Provider adapters (Slack, Teams, email, ...); a channel's `provider` must name one of these. */
  notifiers?: NotifierProvider[];
  /** Email transport. Listed here so its setup/teardown/validation hooks run with the app's. */
  emailSender?: EmailSender;
  /** Site-wide brand and sender settings for outgoing notifications. */
  config?: NotificationsConfig;
}

/** Comparison options. */
export interface ShelfCompareOptions {
  /**
   * Worker threads for pixel diffs: default CPU count minus one (min 1), `0` diffs on the main
   * thread. Takes precedence over `STORYSHELF_DIFF_WORKERS`.
   */
  threads?: number;
}

/** Image-handling options: which library decodes, encodes and resizes the PNGs. */
export interface ShelfImagesOptions {
  /**
   * Image library for diffs, diff overlays and AI thumbnails: `"pngjs"` (default, pure JavaScript,
   * runs anywhere) or `"sharp"` (native, several times faster on large PNGs; needs the optional
   * `sharp` package installed). Falls back to `STORYSHELF_IMAGE_ENGINE`. The pixel comparison is
   * pixelmatch either way, so verdicts match.
   */
  engine?: "pngjs" | "sharp";
}

/** Adapter and configuration options for creating the shelf router. */
export interface ShelfOptions {
  database: DatabaseAdapter;
  storage: StorageAdapter;
  /**
   * Testing (render + diff in the background). Absent means Storybook hosting only: no renderer,
   * no queue, and the tuning below is unreachable rather than silently ignored.
   */
  testing?: ShelfTestingOptions;
  auth?: Auth;
  /** AI insights surface (ADR 0026). Set ⇒ AI on site-wide; absent ⇒ off. */
  ai?: Ai;
  /** Design-tool providers (Figma, …) that resolve links, metadata and previews. */
  design?: DesignProvider[];
  /** Notification subsystem: providers, the email transport, and shared brand/sender settings. */
  notifications?: ShelfNotificationsOptions;
  logger?: Logger;
  ui?: UIConfig;
  config?: ShelfConfig;
  /**
   * Externally-managed observability SDK handle (e.g. from
   * `initObservabilityFromEnv`). Structural — core never imports the
   * observability package. Flushed on `app.lifecycle.teardown()`.
   */
  observability?: ObservabilityHandle;
}

/**
 * Shutdown hook for an externally-managed observability SDK.
 * Structural so core stays dependency-free.
 */
export interface ObservabilityHandle {
  /** Flush exporters and release SDK resources. Must be idempotent. */
  shutdown(): Promise<void>;
}
export { DEFAULT_SCRATCH_DIR, resolveShelfOptions } from "./options.ts";
export { ALLOW_SERVERLESS_ENV, assertServerless, isServerlessHost } from "./serverless.ts";
