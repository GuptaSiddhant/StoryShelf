/**
 * Row type of `content_uses`: one build's use of one shared `content/<hash>` blob (ADR 0039).
 *
 * The row is written once per (build, hash) when the build's content is stored, however many paths
 * of the build name the hash. It is only ever read and written through the
 * `buildReferenceLifecycle` capability, with hash-keyed SQL: the table has no `id` column, so the
 * generic by-key adapter calls do not apply to it.
 */
export interface ContentUse {
  projectId: string;
  buildId: string;
  contentHash: string;
  createdAt: string;
  /** Set once, when the build's cleanup released the use; the row is kept for the grace period. */
  releasedAt: string | null;
  /** Set when a collector claimed the hash for deletion; no new use of the hash is admitted. */
  collectingAt: string | null;
}
