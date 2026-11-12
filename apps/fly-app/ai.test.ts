import { createAi } from "@storyshelf/ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiFromEnv,
  aiLogFields,
  CALLS_PER_PROJECT_PER_HOUR,
  DEFAULT_AI_MODEL,
  DEFAULT_DAILY_TOKENS,
  HEALTH_MAX_TOKENS,
  TRIAGE_MAX_TOKENS,
} from "./ai.ts";

// The real engine runs; the spy only records what it was given (the caps are not on the `Ai` surface).
vi.mock("@storyshelf/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@storyshelf/ai")>();
  return { ...actual, createAi: vi.fn(actual.createAi) };
});

const KEY = "sk-ant-api03-THIS-IS-A-SECRET-KEY";
/** How the engine names an Anthropic model (the id it stores with an insight). */
const idOf = (model: string): string => `anthropic.messages:${model}`;
const withKey = { ANTHROPIC_API_KEY: KEY } as const;

beforeEach(() => {
  vi.mocked(createAi).mockClear();
});

describe("aiFromEnv", () => {
  it.each([{}, { ANTHROPIC_API_KEY: "" }, { ANTHROPIC_API_KEY: undefined }])(
    "gives no AI without the key, so the demo boots as before (%o)",
    (env) => {
      expect(aiFromEnv(env)).toBeUndefined();
      expect(createAi).not.toHaveBeenCalled();
    },
  );

  it("gives one `default` profile with images off and the budget defaults", () => {
    const ai = aiFromEnv(withKey);

    expect(ai?.profileNames()).toEqual(["default"]);
    expect(ai?.defaultProfile()).toBe("default");
    expect(ai?.modelId("default", "triage")).toBe(idOf(DEFAULT_AI_MODEL));
    expect(ai?.modelId("default", "health")).toBe(idOf(DEFAULT_AI_MODEL));
    // Vision off: no screenshot can be sent, whatever the call asks for.
    expect(ai?.hasVision("default", "triage")).toBe(false);
    expect(ai?.budget()).toMatchObject({
      dailyTokens: 100_000,
      perProjectCallsPerHour: 5,
    });
    expect(DEFAULT_DAILY_TOKENS).toBe(100_000);
    expect(CALLS_PER_PROJECT_PER_HOUR).toBe(5);
  });

  it("hands the engine the text-only profile and the small output caps", () => {
    aiFromEnv(withKey);

    const [options] = vi.mocked(createAi).mock.calls[0] ?? [];
    const profile = options?.profiles["default"];
    expect(Object.keys(options?.profiles ?? {})).toEqual(["default"]);
    expect(profile?.models?.vision).toBeNull();
    expect(profile?.models?.triage).toMatchObject({ maxTokens: TRIAGE_MAX_TOKENS });
    expect(profile?.models?.health).toMatchObject({ maxTokens: HEALTH_MAX_TOKENS });
    expect([TRIAGE_MAX_TOKENS, HEALTH_MAX_TOKENS]).toEqual([1000, 2000]);
    // Thinking is off, so it cannot spend the small output cap before the JSON answer.
    const off = { anthropic: { thinking: { type: "disabled" } } };
    expect(profile?.models?.triage).toMatchObject({ providerOptions: off });
    expect(profile?.models?.health).toMatchObject({ providerOptions: off });
  });

  it("passes the boot check without a billed call", async () => {
    const ai = aiFromEnv(withKey);

    // The pinned provider's model specification must be one the pinned `ai` core can drive.
    await expect(ai?.setup()).resolves.toBeUndefined();
    await expect(ai?.health()).resolves.toEqual({ ok: true });
  });

  it("takes the model from SHELF_AI_MODEL, and an empty one means the default", () => {
    const named = aiFromEnv({ ...withKey, SHELF_AI_MODEL: "claude-sonnet-5-5" });
    const empty = aiFromEnv({ ...withKey, SHELF_AI_MODEL: "" });

    expect(named?.modelId("default", "triage")).toBe(idOf("claude-sonnet-5-5"));
    expect(named?.modelId("default", "health")).toBe(idOf("claude-sonnet-5-5"));
    expect(empty?.modelId("default", "triage")).toBe(idOf(DEFAULT_AI_MODEL));
  });

  it("takes the daily token budget from SHELF_AI_DAILY_TOKENS", () => {
    expect(aiFromEnv({ ...withKey, SHELF_AI_DAILY_TOKENS: "250000" })?.budget().dailyTokens).toBe(
      250_000,
    );
  });

  it.each(["abc", "", " ", "0", "-5", "1.5", "NaN", "Infinity", "9007199254740993"])(
    "falls back to the default daily budget for an invalid SHELF_AI_DAILY_TOKENS (%j)",
    (value) => {
      expect(aiFromEnv({ ...withKey, SHELF_AI_DAILY_TOKENS: value })?.budget().dailyTokens).toBe(
        DEFAULT_DAILY_TOKENS,
      );
    },
  );
});

describe("what reaches a log", () => {
  it("names the model and never the key", async () => {
    const ai = aiFromEnv({ ...withKey, SHELF_AI_MODEL: "claude-haiku-5-5" });

    expect(aiLogFields(ai)).toEqual({ aiModel: idOf("claude-haiku-5-5") });
    // Nothing the demo logs or serves about the AI carries the key, and none of it is built from it.
    const observable = JSON.stringify([
      aiLogFields(ai),
      ai?.profileNames(),
      ai?.budget(),
      ai?.limits(),
      await ai?.health(),
      vi.mocked(createAi).mock.calls,
    ]);
    expect(observable).not.toContain(KEY);
    expect(observable).not.toContain("sk-ant");
  });

  it("says there is no model while the AI is off", () => {
    expect(aiLogFields()).toEqual({ aiModel: null });
  });
});
