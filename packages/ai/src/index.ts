/**
 * `@storyshelf/ai`: the AI insights engine on the Vercel AI SDK (ADR 0026).
 *
 * Providers (`@ai-sdk/openai`, `@ai-sdk/anthropic`, Ollama, …) are installed by
 * the deployer and passed in as configured models; this package never sees keys.
 */
import type { Ai, AiBudget, AiTask } from "@storyshelf/core/ai";
import type { Logger } from "@storyshelf/core/logger";
import { modelId, pickDefaultProfile, validateOptions } from "./client.ts";
import { health, setup } from "./lifecycle.ts";
import { slotFor, summarize } from "./operations.ts";
import type { AiState } from "./state.ts";
import type { CreateAiOptions } from "./types.ts";

/** Create the AI surface from named profiles of deployer-supplied models. */
export function createAi<const P extends string>(options: CreateAiOptions<P>): Ai {
  validateOptions(options);
  const state: AiState = {
    profiles: options.profiles,
    defaultProfile: pickDefaultProfile(options),
    budget: toBudget(options),
    limits: options.limits ?? {},
  };
  let logger: Logger | undefined;
  const slot = (
    profile: string | undefined,
    task: AiTask,
    withImages = false,
  ): ReturnType<typeof slotFor> => slotFor(state, profile, task, withImages);
  return {
    summarize: async (input) => await summarize(state, input, () => logger),
    profileNames: () => Object.keys(state.profiles),
    defaultProfile: () => state.defaultProfile,
    hasVision: (profile, task) => slot(profile, task, true).vision,
    modelId: (profile, task, withImages) => modelId(slot(profile, task, withImages).model),
    budget: () => state.budget,
    limits: () => state.limits,
    timeoutMs: (profile, task, withImages) => slot(profile, task, withImages).timeoutMs,
    setLogger: (next) => {
      logger = next;
    },
    setup: async () => {
      await setup(state, otelEnabled(options.otel));
    },
    health: async () => await health(state),
    teardown: async () => {
      await Promise.resolve();
    },
  };
}

function toBudget<P extends string>(options: CreateAiOptions<P>): AiBudget {
  const budget = options.budget ?? {};
  return {
    ...(budget.dailyTokens === undefined ? {} : { dailyTokens: budget.dailyTokens }),
    visionWeight: budget.visionWeight ?? 5,
    perProjectCallsPerHour: budget.perProjectCallsPerHour ?? 50,
  };
}

/** OTEL is on when the host initialised an SDK (standard env switches). */
function otelEnabled(override: boolean | undefined): boolean {
  if (override !== undefined) {
    return override;
  }
  const env = process.env;
  return (
    env["OTEL_SDK_DISABLED"] !== "true" &&
    (Boolean(env["OTEL_EXPORTER_OTLP_ENDPOINT"]) || env["OTEL_DENO"] === "true")
  );
}

export type {
  BudgetOptions,
  CreateAiOptions,
  ModelSlot,
  ProfileConfig,
  ProfileModels,
  SlotProviderOptions,
} from "./types.ts";
