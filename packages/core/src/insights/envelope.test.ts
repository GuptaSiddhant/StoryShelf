import { describe, expect, it } from "vitest";
import { healthEnvelopeSchema, triageEnvelopeSchema } from "./envelope.ts";

describe("envelopes", () => {
  it("accepts a valid triage result and rejects unknown verdicts", () => {
    const ok = {
      verdict: "needs-review",
      summary: "s",
      items: [{ snapshotKey: "a", note: "n", severity: "low" }],
      confidence: "high",
    };
    expect(triageEnvelopeSchema.safeParse(ok).success).toBe(true);
    expect(triageEnvelopeSchema.safeParse({ ...ok, verdict: "approve" }).success).toBe(false);
  });

  it("bounds the health score", () => {
    const ok = { verdict: "healthy", summary: "s", score: 90, trends: [], confidence: "low" };
    expect(healthEnvelopeSchema.safeParse(ok).success).toBe(true);
    expect(healthEnvelopeSchema.safeParse({ ...ok, score: 101 }).success).toBe(false);
  });
});
