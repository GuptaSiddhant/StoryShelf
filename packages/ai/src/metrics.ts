/** Bounded-cardinality OTEL instruments (task + outcome only; ADR 0026 §8). */
import { metrics, type Counter, type Histogram } from "@opentelemetry/api";

interface Instruments {
  duration: Histogram;
  tokens: Histogram;
  completed: Counter;
  failed: Counter;
}

let cached: Instruments | undefined;

function instruments(): Instruments {
  if (!cached) {
    const meter = metrics.getMeter("storyshelf.ai");
    cached = {
      duration: meter.createHistogram("ai.summarize.duration", { unit: "ms" }),
      tokens: meter.createHistogram("ai.summarize.tokens", { unit: "{token}" }),
      completed: meter.createCounter("ai.insights.completed"),
      failed: meter.createCounter("ai.insights.failed"),
    };
  }
  return cached;
}

/** Record one finished call (never per profile, model, story or build). */
export function recordSummarize(
  task: string,
  outcome: "ok" | "error",
  durationMs: number,
  tokens: number,
): void {
  const { duration, tokens: tokenHistogram, completed, failed } = instruments();
  const attributes = { "ai.task": task, outcome };
  duration.record(durationMs, attributes);
  tokenHistogram.record(tokens, attributes);
  (outcome === "ok" ? completed : failed).add(1, { "ai.task": task });
}

/** Test hook: drop memoized instruments so a new meter provider is picked up. */
export function resetMetricsForTests(): void {
  cached = undefined;
}
