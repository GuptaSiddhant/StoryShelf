/**
 * Row type of `build_reviews` (ADR 0013, decision 3): one row per verdict a reviewer gives a
 * build. A reviewer's latest row is their verdict; rewriting inserts a new row.
 */
import type { ReviewVerdict } from "../types.ts";

/** One verdict on one build. */
export interface BuildReview {
  id: string;
  buildId: string;
  /** The reviewer; null when auth is off or an admin token wrote it. */
  userId: string | null;
  verdict: ReviewVerdict;
  body: string | null;
  createdAt: string;
}
