/**
 * AI insights on the Fly demo (ADR 0016): Anthropic, text only, a small budget, and off unless
 * the `ANTHROPIC_API_KEY` secret is set.
 *
 * The key is never read here beyond "is it set": the Anthropic provider takes it from the
 * environment itself, when it makes a call, so it is not in the config this file builds, the boot
 * log, an error or the API output. It must be a Console API key (`sk-ant-api…`); a Claude
 * subscription or Claude Code OAuth token is not supported.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { createAi } from "@storyshelf/ai";
import type { Ai } from "@storyshelf/core/ai";

/** The model when `SS_AI_MODEL` is unset: Anthropic's cheapest current one. */
export const DEFAULT_AI_MODEL = "claude-haiku-5-5";
/** Tokens the demo may spend a day when `SS_AI_DAILY_TOKENS` is unset or invalid. */
export const DEFAULT_DAILY_TOKENS = 100_000;
/** AI calls one project may make in an hour. */
export const CALLS_PER_PROJECT_PER_HOUR = 5;
/** Output caps per task: small, since the demo only needs to show the feature working. */
export const TRIAGE_MAX_TOKENS = 1000;
export const HEALTH_MAX_TOKENS = 2000;

/** An environment value, or undefined when it is unset or empty. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** A positive whole number of tokens, else the default (an unreadable value never turns the budget off). */
function dailyTokensFrom(value: string | undefined): number {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_TOKENS;
}

/**
 * The AI surface for the demo, or `undefined` while `ANTHROPIC_API_KEY` is unset (then the app has
 * no AI: `501 ai-disabled` and no UI, as before). One profile, `default`, with images off, so a
 * screenshot is never sent. Nothing is enabled for a project by itself: a site admin picks the
 * profile under Project settings → AI.
 */
export function aiFromEnv(env: Readonly<Record<string, string | undefined>>): Ai | undefined {
  if (nonEmpty(env["ANTHROPIC_API_KEY"]) === undefined) {
    return undefined;
  }
  const model = anthropic(nonEmpty(env["SS_AI_MODEL"]) ?? DEFAULT_AI_MODEL);
  return createAi({
    profiles: {
      default: {
        defaultModel: model,
        models: {
          vision: null,
          triage: { model, maxTokens: TRIAGE_MAX_TOKENS },
          health: { model, maxTokens: HEALTH_MAX_TOKENS },
        },
      },
    },
    budget: {
      dailyTokens: dailyTokensFrom(env["SS_AI_DAILY_TOKENS"]),
      perProjectCallsPerHour: CALLS_PER_PROJECT_PER_HOUR,
    },
  });
}

/** What the boot log says about the AI surface: the model in use, never the key. */
export function aiLogFields(ai?: Ai): { aiModel: string | null } {
  return { aiModel: ai === undefined ? null : ai.modelId(ai.defaultProfile(), "triage") };
}
