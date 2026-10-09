import { metrics } from "@opentelemetry/api";
import { triageEnvelopeSchema } from "@storyshelf/core/insights";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAi } from "./index.ts";
import { resetMetricsForTests } from "./metrics.ts";
import { TRIAGE_JSON, mockModel } from "./test-support.ts";

interface Recorded {
  name: string;
  value: number;
  attributes: Record<string, unknown>;
}

function stubMeterProvider(): Recorded[] {
  const recorded: Recorded[] = [];
  const instrument = (name: string) => ({
    record: (value: number, attributes: Record<string, unknown> = {}) =>
      recorded.push({ name, value, attributes }),
    add: (value: number, attributes: Record<string, unknown> = {}) =>
      recorded.push({ name, value, attributes }),
  });
  metrics.setGlobalMeterProvider({
    getMeter: () => ({
      createHistogram: (name: string) => instrument(name),
      createCounter: (name: string) => instrument(name),
    }),
  } as never);
  return recorded;
}

afterEach(() => {
  metrics.disable();
  resetMetricsForTests();
});

const input = {
  task: "triage" as const,
  system: "s",
  evidence: { text: "SENTINEL-PROMPT", images: [] },
  schema: triageEnvelopeSchema,
};

describe("ai metrics", () => {
  it("records bounded task/outcome series on success", async () => {
    const recorded = stubMeterProvider();
    const ai = createAi({ profiles: { default: { defaultModel: mockModel([TRIAGE_JSON]) } } });
    await ai.summarize(input);
    const names = recorded.map((r) => r.name).toSorted();
    expect(names).toEqual([
      "ai.insights.completed",
      "ai.summarize.duration",
      "ai.summarize.tokens",
    ]);
    expect(recorded.find((r) => r.name === "ai.summarize.tokens")?.value).toBe(30);
    const dump = JSON.stringify(recorded.map((r) => r.attributes));
    expect(dump).not.toContain("SENTINEL");
    expect(dump).not.toContain("default");
  });

  it("counts failures with the usage the provider billed", async () => {
    const recorded = stubMeterProvider();
    const ai = createAi({ profiles: { default: { defaultModel: mockModel(["nope", "nope"]) } } });
    await expect(ai.summarize(input)).rejects.toThrow();
    expect(recorded.some((r) => r.name === "ai.insights.failed")).toBe(true);
    vi.restoreAllMocks();
  });
});
