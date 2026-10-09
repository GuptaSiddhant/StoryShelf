/** Pure slot resolution, effective-vision rules and option validation. */
import type { AiTask } from "@storyshelf/core/ai";
import type { LanguageModel } from "ai";
import {
  type CreateAiOptions,
  type ModelSlot,
  type ProfileConfig,
  TASK_DEFAULTS,
} from "./types.ts";

/** A slot with defaults applied. */
export interface ResolvedSlot {
  model: LanguageModel;
  maxTokens: number;
  timeoutMs: number;
  /** Declared vision flag (undefined = not declared). */
  declaredVision: boolean | undefined;
}

/** True for the object form `{ model, ... }` (a bare model has a spec version). */
function isObjectSlot(slot: ModelSlot): slot is Extract<ModelSlot, { model: LanguageModel }> {
  return (
    typeof slot === "object" &&
    slot !== null &&
    "model" in slot &&
    !("specificationVersion" in slot)
  );
}

/** Normalize a slot, applying the task defaults. */
export function resolveSlot(slot: ModelSlot, task: AiTask): ResolvedSlot {
  const defaults = TASK_DEFAULTS[task];
  if (isObjectSlot(slot)) {
    return {
      model: slot.model,
      maxTokens: slot.maxTokens ?? defaults.maxTokens,
      timeoutMs: slot.timeoutMs ?? defaults.timeoutMs,
      declaredVision: slot.vision,
    };
  }
  return { model: slot, ...defaults, declaredVision: undefined };
}

/** The slot chosen for a call and whether it accepts images. */
export interface EffectiveSlot extends ResolvedSlot {
  vision: boolean;
}

/**
 * Effective vision (ADR 0026 §3): a `vision` slot is assumed vision-capable
 * unless it declares `vision: false`; `vision: null` disables images; a base
 * slot only counts when it declares `vision: true`.
 */
export function effectiveSlot(profile: ProfileConfig, task: AiTask): EffectiveSlot {
  const base = resolveSlot(profile.models?.[task] ?? profile.defaultModel, task);
  const visionSlot = task === "triage" ? profile.models?.vision : undefined;
  if (visionSlot) {
    const resolved = resolveSlot(visionSlot, task);
    return { ...resolved, vision: resolved.declaredVision !== false };
  }
  return { ...base, vision: visionSlot !== null && base.declaredVision === true };
}

/** Stable identifier of a model for rows and cache hashing. */
export function modelId(model: LanguageModel): string {
  if (typeof model === "string") {
    return model;
  }
  return `${model.provider}:${model.modelId}`;
}

/** Throw on an unusable `createAi` configuration. */
export function validateOptions<P extends string>(options: CreateAiOptions<P>): void {
  const names = Object.keys(options.profiles);
  if (names.length === 0) {
    throw new Error("createAi: `profiles` must define at least one profile");
  }
  if (names.includes("")) {
    throw new Error("createAi: profile names must be non-empty");
  }
  if (options.defaultProfile !== undefined && !names.includes(options.defaultProfile)) {
    throw new Error(`createAi: unknown defaultProfile "${options.defaultProfile}"`);
  }
}

/** The default profile name: explicit, else `default`, else the first key. */
export function pickDefaultProfile<P extends string>(options: CreateAiOptions<P>): string {
  const names = Object.keys(options.profiles);
  return options.defaultProfile ?? (names.includes("default") ? "default" : (names[0] ?? ""));
}
