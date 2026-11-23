/** Shared OTEL test harness: in-memory spans with async context propagation. */
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/** Installed telemetry: span exporter plus global-state cleanup. */
export interface TestTelemetry {
  exporter: InMemorySpanExporter;
  cleanup(): Promise<void>;
}

/**
 * Register an in-memory tracer provider and ALS context manager globally.
 * Pair with `cleanup()` in `afterEach` to restore the noop defaults.
 */
export function installTestTelemetry(): TestTelemetry {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  const manager = new AsyncLocalStorageContextManager();
  context.setGlobalContextManager(manager.enable());
  return {
    exporter,
    cleanup: async (): Promise<void> => {
      await provider.shutdown();
      context.disable();
      propagation.disable();
      trace.disable();
    },
  };
}
