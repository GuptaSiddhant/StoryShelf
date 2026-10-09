/** Test double for the `Ai` surface (never shipped). */
import type { Ai, AiError, AiSummarizeInput } from "@storyshelf/core/ai";

const TRIAGE = { verdict: "needs-review", summary: "s", items: [], confidence: "low" };
const HEALTH = { verdict: "healthy", summary: "h", score: 90, trends: [], confidence: "low" };

/** Options for {@link fakeAi}. */
export interface FakeOptions {
  dailyTokens?: number;
  fail?: AiError;
}

export function fakeAi(options: FakeOptions = {}): Ai & { calls: AiSummarizeInput<unknown>[] } {
  const calls: AiSummarizeInput<unknown>[] = [];
  return {
    calls,
    summarize: async (input: AiSummarizeInput<unknown>) => {
      calls.push(input);
      await Promise.resolve();
      if (options.fail) {
        throw options.fail;
      }
      return {
        object: input.task === "health" ? HEALTH : TRIAGE,
        usage: { inputTokens: 20, outputTokens: 10, estimated: false },
        profileRequested: input.profile ?? null,
        profileEffective: input.profile ?? "default",
        model: "fake:m",
        imagesSent: 0,
        visionSkipped: false,
        warnings: [],
      } as never;
    },
    profileNames: () => ["default", "thorough"],
    defaultProfile: () => "default",
    hasVision: () => false,
    modelId: (profile) => `fake:${profile ?? "default"}`,
    budget: () => ({
      visionWeight: 5,
      perProjectCallsPerHour: 50,
      ...(options.dailyTokens === undefined ? {} : { dailyTokens: options.dailyTokens }),
    }),
    limits: () => ({}),
    timeoutMs: () => 1000,
    setup: async () => {
      await Promise.resolve();
    },
    health: async () => {
      await Promise.resolve();
      return { ok: true };
    },
    teardown: async () => {
      await Promise.resolve();
    },
  };
}
