/** Result envelopes the model must produce (validated; stored as opaque JSON text). */
import { z } from "zod";

const severitySchema = z.enum(["info", "low", "medium", "high"]);
const confidenceSchema = z.enum(["low", "medium", "high"]);

/** Verdicts for a build triage (advisory only; never approves or waives). */
export const TRIAGE_VERDICTS = ["likely-intended", "needs-review", "likely-regression"] as const;

/** Verdicts for a project-health digest. */
export const HEALTH_VERDICTS = ["healthy", "watch", "unhealthy"] as const;

/** Build triage envelope. */
export const triageEnvelopeSchema = z.object({
  verdict: z.enum(TRIAGE_VERDICTS),
  summary: z.string().max(1200),
  items: z
    .array(
      z.object({
        snapshotKey: z.string().max(200),
        note: z.string().max(400),
        severity: severitySchema,
      }),
    )
    .max(50),
  confidence: confidenceSchema,
});

/** Project-health digest envelope. */
export const healthEnvelopeSchema = z.object({
  verdict: z.enum(HEALTH_VERDICTS),
  summary: z.string().max(1200),
  score: z.number().min(0).max(100),
  trends: z
    .array(
      z.object({
        label: z.string().max(80),
        note: z.string().max(300),
        direction: z.enum(["up", "down", "flat"]),
      }),
    )
    .max(10),
  confidence: confidenceSchema,
});

/** A parsed triage result. */
export type TriageEnvelope = z.infer<typeof triageEnvelopeSchema>;
/** A parsed health result. */
export type HealthEnvelope = z.infer<typeof healthEnvelopeSchema>;
