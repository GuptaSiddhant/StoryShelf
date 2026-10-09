/** `summarize`: profile resolution, vision fallback, timeout and spans. */
import { AiError, type AiSummarizeInput, type AiSummarizeResult } from "@storyshelf/core/ai";
import type { Logger } from "@storyshelf/core/logger";
import { effectiveSlot, modelId, type EffectiveSlot } from "./client.ts";
import { runStructured, toAiError, type StructuredResult } from "./codec.ts";
import type { AiState } from "./state.ts";
import { withSpan } from "./telemetry.ts";
import type { ProfileConfig } from "./types.ts";

/** Resolve the requested profile; unknown names fall back with a warning. */
export function resolveProfile(
  state: AiState,
  requested: string | undefined,
): { name: string; profile: ProfileConfig; warnings: string[] } {
  const known = requested === undefined ? undefined : state.profiles[requested];
  const name = known && requested !== undefined ? requested : state.defaultProfile;
  const profile = state.profiles[name];
  if (!profile) {
    throw new Error(`@storyshelf/ai: profile "${name}" is not configured`);
  }
  const warnings = requested !== undefined && !known ? [`unknown-profile:${requested}`] : [];
  return { name, profile, warnings };
}

/** The effective slot a call would use. */
export function slotFor(
  state: AiState,
  profile: string | undefined,
  task: AiSummarizeInput<unknown>["task"],
): EffectiveSlot {
  return effectiveSlot(resolveProfile(state, profile).profile, task);
}

function signalFor(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

/** Try with images; a provider rejection falls back to text-only once. */
async function callWithVisionFallback<T>(
  input: AiSummarizeInput<T>,
  slot: EffectiveSlot,
  onSkip: () => void,
): Promise<StructuredResult<T>> {
  const base = {
    ...input,
    model: slot.model,
    maxTokens: slot.maxTokens,
    signal: signalFor(input.signal, slot.timeoutMs),
  };
  const useImages = input.evidence.images.length > 0 && slot.vision;
  try {
    return await runStructured({ ...base, withImages: useImages });
  } catch (error) {
    if (!useImages || !(error instanceof AiError) || error.code !== "provider") {
      throw error;
    }
    onSkip();
    return await runStructured({ ...base, withImages: false });
  }
}

/** Run one structured summarize call. */
export async function summarize<T>(
  state: AiState,
  input: AiSummarizeInput<T>,
  logger: () => Logger | undefined,
): Promise<AiSummarizeResult<T>> {
  const { name, profile, warnings } = resolveProfile(state, input.profile);
  const slot = effectiveSlot(profile, input.task);
  const model = modelId(slot.model);
  const wantsImages = input.evidence.images.length > 0;
  return await withSpan(
    "ai.summarize",
    async (span) => {
      let skipped = wantsImages && !slot.vision;
      try {
        const done = await callWithVisionFallback(input, slot, () => {
          skipped = true;
          span.addEvent("vision-skipped");
        });
        logger()?.info({ task: input.task, profile: name, model }, "ai summarize done");
        const extra = skipped && wantsImages ? ["vision-skipped"] : [];
        return {
          object: done.object,
          usage: done.usage,
          profileRequested: input.profile ?? null,
          profileEffective: name,
          model,
          imagesSent: done.imagesSent,
          visionSkipped: skipped,
          warnings: [...warnings, ...extra],
        };
      } catch (error) {
        const failure = toAiError(error);
        logger()?.warn(
          { task: input.task, profile: name, code: failure.code },
          "ai summarize failed",
        );
        throw failure;
      }
    },
    { "ai.task": input.task, "ai.profile": name, "ai.model": model },
  );
}
