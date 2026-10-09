import type { Span } from "@opentelemetry/api";
/** `summarize`: profile resolution, vision fallback, timeout and spans. */
import { AiError, type AiSummarizeInput, type AiSummarizeResult } from "@storyshelf/core/ai";
import type { Logger } from "@storyshelf/core/logger";
import { effectiveSlot, modelId, type EffectiveSlot } from "./client.ts";
import { runStructured, toAiError, type StructuredResult } from "./codec.ts";
import { recordSummarize } from "./metrics.ts";
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
  withImages = false,
): EffectiveSlot {
  return effectiveSlot(resolveProfile(state, profile).profile, task, withImages);
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
    providerOptions: slot.providerOptions,
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

interface CallContext<T> {
  input: AiSummarizeInput<T>;
  slot: EffectiveSlot;
  name: string;
  model: string;
  warnings: string[];
  log: Logger | undefined;
}

function toResult<T>(
  ctx: CallContext<T>,
  done: StructuredResult<T>,
  skipped: boolean,
): AiSummarizeResult<T> {
  const wantsImages = ctx.input.evidence.images.length > 0;
  return {
    object: done.object,
    usage: done.usage,
    profileRequested: ctx.input.profile ?? null,
    profileEffective: ctx.name,
    model: ctx.model,
    imagesSent: done.imagesSent,
    visionSkipped: skipped,
    warnings: [...ctx.warnings, ...(skipped && wantsImages ? ["vision-skipped"] : [])],
  };
}

function noteOk<T>(ctx: CallContext<T>, done: StructuredResult<T>, started: number): void {
  const tokens = done.usage.inputTokens + done.usage.outputTokens;
  recordSummarize(ctx.input.task, "ok", performance.now() - started, tokens);
  ctx.log?.info({ task: ctx.input.task, profile: ctx.name, model: ctx.model }, "ai summarize done");
}

function noteError<T>(ctx: CallContext<T>, failure: AiError, started: number): void {
  const billed = (failure.usage?.inputTokens ?? 0) + (failure.usage?.outputTokens ?? 0);
  recordSummarize(ctx.input.task, "error", performance.now() - started, billed);
  ctx.log?.warn(
    { task: ctx.input.task, profile: ctx.name, code: failure.code },
    "ai summarize failed",
  );
}

async function runMeasured<T>(
  ctx: CallContext<T>,
  span: Span,
  started: number,
): Promise<AiSummarizeResult<T>> {
  let skipped = ctx.input.evidence.images.length > 0 && !ctx.slot.vision;
  try {
    const done = await callWithVisionFallback(ctx.input, ctx.slot, () => {
      skipped = true;
      span.addEvent("vision-skipped");
    });
    noteOk(ctx, done, started);
    return toResult(ctx, done, skipped);
  } catch (error) {
    const failure = toAiError(error);
    noteError(ctx, failure, started);
    throw failure;
  }
}

/** Run one structured summarize call. */
export async function summarize<T>(
  state: AiState,
  input: AiSummarizeInput<T>,
  logger: () => Logger | undefined,
): Promise<AiSummarizeResult<T>> {
  const { name, profile, warnings } = resolveProfile(state, input.profile);
  const slot = effectiveSlot(profile, input.task, input.evidence.images.length > 0);
  const ctx: CallContext<T> = {
    input,
    slot,
    name,
    model: modelId(slot.model),
    warnings,
    log: logger(),
  };
  const started = performance.now();
  return await withSpan("ai.summarize", async (span) => await runMeasured(ctx, span, started), {
    "ai.task": input.task,
    "ai.profile": name,
    "ai.model": ctx.model,
  });
}
