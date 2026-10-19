/**
 * AI singleton surface (not an adapter; see ADR 0026).
 *
 * Owned by core so `ShelfOptions.ai` needs no dependency edge into the
 * implementation package (`@storyshelf/ai` already depends on core). The
 * package implements and re-exports {@link Ai}.
 */
import type { z } from "zod";
import type { EvidenceLimits } from "./insights/limits.ts";
import type { Logger } from "./logger.ts";

/** Tasks the AI surface routes: build triage and project health. */
export type AiTask = "triage" | "health";

/** One screenshot sent to a vision-capable model. */
export interface AiImage {
  mediaType: "image/png";
  data: Uint8Array;
  /** Short caption (story, viewport) shown to the model before the image. */
  label: string;
}

/** Evidence handed to the model: delimited text plus optional images. */
export interface AiEvidence {
  text: string;
  images: AiImage[];
}

/** Provider-reported (or estimated) token usage for one call. */
export interface AiUsageReport {
  inputTokens: number;
  outputTokens: number;
  /** True when the backend reported nothing and a char/4 estimate was used. */
  estimated: boolean;
}

/** Input for {@link Ai.summarize}. */
export interface AiSummarizeInput<T> {
  task: AiTask;
  /** Requested profile; falls back to the default profile with a warning. */
  profile?: string;
  system: string;
  evidence: AiEvidence;
  /** Result schema (the model output is validated against it). */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

/** Result of one successful summarize call. */
export interface AiSummarizeResult<T> {
  object: T;
  usage: AiUsageReport;
  profileRequested: string | null;
  profileEffective: string;
  model: string;
  /** Number of images actually sent to the model. */
  imagesSent: number;
  /** True when images were dropped (no vision model, or provider rejected them). */
  visionSkipped: boolean;
  warnings: string[];
}

/** Instance-level budget options (all optional). */
export interface AiBudget {
  /** Site-wide daily token cap (UTC day); undefined = no daily cap. */
  dailyTokens?: number;
  /** Multiplier applied to tokens counted for calls that sent images. */
  visionWeight: number;
  /** Per-project call cap per rolling hour. */
  perProjectCallsPerHour: number;
}

/** Why a summarize call failed. */
export type AiErrorCode = "timeout" | "provider" | "schema" | "aborted" | "unknown";

/** Failure from {@link Ai.summarize}; carries usage the provider still billed. */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly usage?: AiUsageReport,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AiError";
  }
}

/** Health probe result. */
export interface AiHealth {
  ok: boolean;
  detail?: string;
}

/** The AI surface consumed by `ShelfOptions.ai`. */
export interface Ai {
  /** Run one structured summarize call against a profile's model. */
  summarize<T>(input: AiSummarizeInput<T>): Promise<AiSummarizeResult<T>>;
  /** Configured profile names. */
  profileNames(): string[];
  /** The profile used when none (or an unknown one) is requested. */
  defaultProfile(): string;
  /** Whether the profile has an effective vision model for the task. */
  hasVision(profile: string | undefined, task: AiTask): boolean;
  /** Stable identifier of the model a call would use (for hashing/rows). */
  modelId(profile: string | undefined, task: AiTask, withImages?: boolean): string;
  /** Budget options (with defaults applied). */
  budget(): AiBudget;
  /** Evidence limit overrides configured on the instance. */
  limits(): Partial<EvidenceLimits>;
  /** Per-slot timeout in milliseconds. */
  timeoutMs(profile: string | undefined, task: AiTask, withImages?: boolean): number;
  /** Host-bound scoped logger. */
  setLogger?(logger: Logger): void;
  /** Free boot checks (spec version, wiring); never a billed call. */
  setup(): Promise<void>;
  /** Cheap liveness probe; never inference. */
  health(): Promise<AiHealth>;
  /** Release resources (unregisters nothing global). */
  teardown(): Promise<void>;
}
