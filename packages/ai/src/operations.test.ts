import { AiError } from "@storyshelf/core/ai";
import { triageEnvelopeSchema } from "@storyshelf/core/insights";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { createAi } from "./index.ts";
import { resetOtelRegistrationForTests } from "./telemetry.ts";
import { TRIAGE_JSON, installTestTelemetry, mockModel } from "./test-support.ts";

const png = { mediaType: "image/png" as const, data: new Uint8Array([1, 2, 3]), label: "A" };
const input = (over = {}) => ({
  task: "triage" as const,
  system: "sys",
  evidence: { text: "e", images: [png] },
  schema: triageEnvelopeSchema,
  ...over,
});

afterEach(() => {
  resetOtelRegistrationForTests();
});

describe("summarize", () => {
  it("falls back to the default profile with a warning for unknown names", async () => {
    const ai = createAi({ profiles: { default: { defaultModel: mockModel([TRIAGE_JSON]) } } });
    const result = await ai.summarize(input({ profile: "ghost" }));
    expect(result.profileRequested).toBe("ghost");
    expect(result.profileEffective).toBe("default");
    expect(result.warnings).toContain("unknown-profile:ghost");
  });

  it("drops images for a text-only profile and marks visionSkipped", async () => {
    const model = mockModel([TRIAGE_JSON]);
    const ai = createAi({ profiles: { default: { defaultModel: model } } });
    const result = await ai.summarize(input());
    expect(result.imagesSent).toBe(0);
    expect(result.visionSkipped).toBe(true);
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).not.toContain("Screenshot");
  });

  it("sends images to a vision model", async () => {
    const vision = mockModel([TRIAGE_JSON]);
    const ai = createAi({
      profiles: { default: { defaultModel: mockModel([TRIAGE_JSON]), models: { vision } } },
    });
    const result = await ai.summarize(input());
    expect(result.imagesSent).toBe(1);
    expect(result.visionSkipped).toBe(false);
    expect(ai.hasVision(undefined, "triage")).toBe(true);
  });

  it("falls back to text when the provider rejects images", async () => {
    let calls = 0;
    const vision = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        await Promise.resolve();
        if (calls === 1) {
          const { APICallError } = await import("ai");
          throw new APICallError({
            message: "no images",
            url: "u",
            requestBodyValues: {},
            statusCode: 400,
          });
        }
        return {
          content: [{ type: "text", text: TRIAGE_JSON }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const ai = createAi({
      profiles: { default: { defaultModel: mockModel([TRIAGE_JSON]), models: { vision } } },
    });
    const result = await ai.summarize(input());
    expect(result.visionSkipped).toBe(true);
    expect(result.warnings).toContain("vision-skipped");
    expect(calls).toBe(2);
  });

  it("surfaces a timeout as an AiError", async () => {
    const slow = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) =>
        await new Promise((_resolve, reject) => {
          abortSignal?.addEventListener("abort", () => {
            reject(abortSignal.reason as Error);
          });
        }),
    });
    const ai = createAi({
      profiles: { default: { defaultModel: { model: slow, timeoutMs: 20 } } },
    });
    const error = await ai
      .summarize(input({ evidence: { text: "e", images: [] } }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(["timeout", "aborted"]).toContain((error as AiError).code);
  });
});

describe("telemetry privacy", () => {
  it("never puts prompts, evidence or images into spans or events", async () => {
    const telemetry = installTestTelemetry();
    try {
      const ai = createAi({
        otel: true,
        profiles: { default: { defaultModel: mockModel([TRIAGE_JSON]) } },
      });
      await ai.setup();
      await ai.summarize(
        input({
          system: "SENTINEL-SYSTEM",
          evidence: { text: "SENTINEL-EVIDENCE", images: [png] },
        }),
      );
      const spans = telemetry.exporter.getFinishedSpans();
      expect(spans.length).toBeGreaterThan(0);
      expect(spans.some((s) => s.name === "ai.summarize")).toBe(true);
      const dump = JSON.stringify(spans.map((s) => ({ a: s.attributes, e: s.events })));
      expect(dump).not.toContain("SENTINEL");
    } finally {
      await telemetry.cleanup();
    }
  });
});

describe("providerOptions", () => {
  it("forwards slot provider options to the model call, per slot", async () => {
    const base = mockModel([TRIAGE_JSON]);
    const vision = mockModel([TRIAGE_JSON]);
    const ai = createAi({
      profiles: {
        default: {
          defaultModel: { model: base, providerOptions: { openai: { reasoningEffort: "low" } } },
          models: {
            vision: { model: vision, providerOptions: { openai: { reasoningEffort: "minimal" } } },
          },
        },
      },
    });
    await ai.summarize(input({ evidence: { text: "e", images: [] } }));
    expect(base.doGenerateCalls[0]?.providerOptions).toEqual({
      openai: { reasoningEffort: "low" },
    });
    await ai.summarize(input());
    expect(vision.doGenerateCalls[0]?.providerOptions).toEqual({
      openai: { reasoningEffort: "minimal" },
    });
  });

  it("sends none when the slot has none", async () => {
    const model = mockModel([TRIAGE_JSON]);
    const ai = createAi({ profiles: { default: { defaultModel: model } } });
    await ai.summarize(input({ evidence: { text: "e", images: [] } }));
    expect(model.doGenerateCalls[0]?.providerOptions).toBeUndefined();
  });
});
