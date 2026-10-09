/** Deterministic evidence limits (defaults; overridable in `createAi` options). */

/** Caps applied when assembling evidence. */
export interface EvidenceLimits {
  maxImages: number;
  /** Long-edge pixels for thumbnails. */
  imageMaxEdge: number;
  /** Bytes kept from the start / end of each log. */
  logHeadBytes: number;
  logTailBytes: number;
  /** Total text evidence cap in bytes. */
  maxTextBytes: number;
  /** Changed snapshots listed individually. */
  maxSnapshots: number;
}

/** Default limits from ADR 0026 §5. */
export const DEFAULT_EVIDENCE_LIMITS: EvidenceLimits = {
  maxImages: 3,
  imageMaxEdge: 512,
  logHeadBytes: 2048,
  logTailBytes: 2048,
  maxTextBytes: 24_576,
  maxSnapshots: 50,
};

/** Merge partial overrides onto the defaults. */
export function resolveLimits(overrides?: Partial<EvidenceLimits>): EvidenceLimits {
  return { ...DEFAULT_EVIDENCE_LIMITS, ...overrides };
}
