/** Options and slot types for `createAi` (no behavior). */
import type { EvidenceLimits } from "@storyshelf/core/insights";
import type { LanguageModel } from "ai";

/** A model, or a model with per-slot overrides. */
export type ModelSlot =
  | LanguageModel
  | {
      model: LanguageModel;
      /** Max output tokens (defaults: triage ~1500, health ~4000). */
      maxTokens?: number;
      /** Declared vision capability (see ADR 0026 §3 effective-vision rules). */
      vision?: boolean;
      /** Per-call timeout in milliseconds. */
      timeoutMs?: number;
    };

/** Per-task models of one profile; `vision: null` disables images. */
export interface ProfileModels {
  triage?: ModelSlot;
  vision?: ModelSlot | null;
  health?: ModelSlot;
}

/** One named profile (an admin's data-flow decision). */
export interface ProfileConfig {
  defaultModel: ModelSlot;
  models?: ProfileModels;
}

/** Instance-level budget options. */
export interface BudgetOptions {
  dailyTokens?: number;
  visionWeight?: number;
  perProjectCallsPerHour?: number;
}

/** Options for {@link createAi}. */
export interface CreateAiOptions<P extends string> {
  profiles: Record<P, ProfileConfig>;
  /** Defaults to the `default` key if present, else the first key. */
  defaultProfile?: NoInfer<P>;
  budget?: BudgetOptions;
  /** Force SDK telemetry registration on/off (default: on when `OTEL_EXPORTER_OTLP_ENDPOINT` is set). */
  otel?: boolean;
  /** Evidence limit overrides (ADR 0026 §5 defaults otherwise). */
  limits?: Partial<EvidenceLimits>;
}

/** Task token/time defaults. */
export const TASK_DEFAULTS = {
  triage: { maxTokens: 1500, timeoutMs: 60_000 },
  health: { maxTokens: 4000, timeoutMs: 180_000 },
} as const;
