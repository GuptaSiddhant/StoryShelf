import { AiError } from "@storyshelf/core/ai";
import { triageEnvelopeSchema } from "@storyshelf/core/insights";
import { describe, expect, it } from "vitest";
import { runStructured, toAiError, toUsage } from "./codec.ts";
import { TRIAGE_JSON, mockModel } from "./test-support.ts";

const evidence = { text: "<evidence>x</evidence>", images: [] };

const call = (model: ReturnType<typeof mockModel>, withImages = false) => ({
  model,
  task: "triage" as const,
  system: "sys",
  evidence,
  schema: triageEnvelopeSchema,
  maxTokens: 100,
  signal: new AbortController().signal,
  withImages,
});

describe("runStructured", () => {
  it("parses a valid envelope and reports provider usage", async () => {
    const result = await runStructured(call(mockModel([TRIAGE_JSON])));
    expect(result.object.verdict).toBe("needs-review");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20, estimated: false });
  });

  it("repairs once after invalid JSON and accumulates usage", async () => {
    const model = mockModel(["not json", TRIAGE_JSON]);
    const result = await runStructured(call(model));
    expect(result.object.confidence).toBe("low");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(result.usage.inputTokens).toBeGreaterThan(10);
  });

  it("fails with a schema error (carrying usage) after the single retry", async () => {
    const model = mockModel(["nope", "still nope"]);
    const error = await runStructured(call(model)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe("schema");
    expect((error as AiError).usage?.inputTokens).toBeGreaterThan(0);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("sends images as parts only when asked", async () => {
    const withImage = {
      text: "e",
      images: [{ mediaType: "image/png" as const, data: new Uint8Array([1, 2, 3]), label: "A" }],
    };
    const model = mockModel([TRIAGE_JSON]);
    await runStructured({ ...call(model, true), evidence: withImage });
    const content = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(content).toContain("Screenshot: A");
    const plain = mockModel([TRIAGE_JSON]);
    const out = await runStructured({ ...call(plain, false), evidence: withImage });
    expect(out.imagesSent).toBe(0);
    expect(JSON.stringify(plain.doGenerateCalls[0]?.prompt)).not.toContain("Screenshot");
  });
});

describe("helpers", () => {
  it("estimates usage when the backend reports nothing", () => {
    expect(toUsage(40)).toEqual({ inputTokens: 10, outputTokens: 0, estimated: true });
  });

  it("classifies aborts and unknown errors", () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(toAiError(timeout).code).toBe("timeout");
    expect(toAiError(Object.assign(new Error("a"), { name: "AbortError" })).code).toBe("aborted");
    expect(toAiError("boom").code).toBe("unknown");
  });
});
