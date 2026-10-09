/** Test helpers: mock models and an in-memory OTEL harness (never shipped). */
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { MockLanguageModelV4 } from "ai/test";

/** A mock model replying with `texts[i]` on call i (last repeats). */
export function mockModel(texts: string[]): MockLanguageModelV4 {
  const usage = { input: 10, output: 20 };
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const text = texts[Math.min(call, texts.length - 1)] ?? "";
      call += 1;
      await Promise.resolve();
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: usage.input,
            noCache: usage.input,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

/** A valid triage envelope as JSON text. */
export const TRIAGE_JSON = JSON.stringify({
  verdict: "needs-review",
  summary: "ok",
  items: [],
  confidence: "low",
});

/** Install an in-memory tracer provider + context manager. */
export function installTestTelemetry(): {
  exporter: InMemorySpanExporter;
  cleanup(): Promise<void>;
} {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  return {
    exporter,
    cleanup: async () => {
      await provider.shutdown();
      context.disable();
      propagation.disable();
      trace.disable();
    },
  };
}
