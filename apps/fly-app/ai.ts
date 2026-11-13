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

/** The demo's model, fixed: Anthropic's cheapest current one (#992). */
export const DEFAULT_AI_MODEL = "claude-haiku-5-5";
/** Tokens the demo may spend a day, fixed (#992). */
export const DEFAULT_DAILY_TOKENS = 100_000;
/** AI calls one project may make in an hour. */
export const CALLS_PER_PROJECT_PER_HOUR = 5;
/** Output caps per task: small, since the demo only needs to show the feature working. */
export const TRIAGE_MAX_TOKENS = 1000;
export const HEALTH_MAX_TOKENS = 2000;

/**
 * Thinking tokens count against the output cap, so with thinking on a small cap can run out before
 * the JSON answer starts. The demo asks for none; the provider drops this (with a warning) on a
 * model that cannot turn thinking off.
 */
const NO_THINKING = { anthropic: { thinking: { type: "disabled" } } } as const;

/**
 * The AI surface for the demo, or `undefined` while `ANTHROPIC_API_KEY` is unset (then the app has
 * no AI: `501 ai-disabled` and no UI, as before). One profile, `default`, with images off, so a
 * screenshot is never sent. The model and the budget are fixed here, not read from the environment
 * (#992). Nothing is enabled for a project by itself: a site admin picks the profile under Project
 * settings → AI, and `seed.sh` does that for the demo project.
 */
export function aiFromEnv(env: Readonly<Record<string, string | undefined>>): Ai | undefined {
  if (env["ANTHROPIC_API_KEY"] === undefined || env["ANTHROPIC_API_KEY"] === "") {
    return undefined;
  }
  const model = anthropic(DEFAULT_AI_MODEL);
  return createAi({
    profiles: {
      default: {
        defaultModel: model,
        models: {
          vision: null,
          triage: { model, maxTokens: TRIAGE_MAX_TOKENS, providerOptions: NO_THINKING },
          health: { model, maxTokens: HEALTH_MAX_TOKENS, providerOptions: NO_THINKING },
        },
      },
    },
    budget: {
      dailyTokens: DEFAULT_DAILY_TOKENS,
      perProjectCallsPerHour: CALLS_PER_PROJECT_PER_HOUR,
    },
  });
}

/** What the boot log says about the AI surface: the model in use, never the key. */
export function aiLogFields(ai?: Ai): { aiModel: string | null } {
  return { aiModel: ai === undefined ? null : ai.modelId(ai.defaultProfile(), "triage") };
}
