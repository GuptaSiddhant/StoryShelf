/** Insight evidence, redaction, hashing, budget math and result envelopes (pure; no SDK). */
export { buildTriageEvidence, rankSnapshots, snapshotKey } from "./evidence.ts";
export type { BuiltEvidence, SnapshotEvidence, TriageEvidenceInput } from "./evidence.ts";
export { buildHealthEvidence } from "./evidence-health.ts";
export type { BuildSummary, HealthEvidenceInput } from "./evidence-health.ts";
export { healthEnvelopeSchema, triageEnvelopeSchema } from "./envelope.ts";
export type { HealthEnvelope, TriageEnvelope } from "./envelope.ts";
export { computeInputHash } from "./hash.ts";
export type { InputHashParts } from "./hash.ts";
export { DEFAULT_EVIDENCE_LIMITS, resolveLimits } from "./limits.ts";
export type { EvidenceLimits } from "./limits.ts";
export { redactText } from "./redact.ts";
export {
  BUDGET_THRESHOLDS,
  countedTokens,
  crossedThresholds,
  utcDay,
  utcDayStart,
} from "./budget.ts";
export { HEALTH_SYSTEM, PROMPT_VERSION, TRIAGE_SYSTEM } from "./prompts/v1.ts";
