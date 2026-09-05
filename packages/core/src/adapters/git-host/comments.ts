import type { Logger } from "pino";
import { commentMarker } from "./helpers.ts";

/** A review thread (PR or MR) hosting a single StoryShelf comment. */
export interface ReviewThread {
  /** List existing comments as id/body pairs. */
  list(): Promise<{ id: string | number; body: string }[]>;
  /** Replace the body of an existing comment, returning its id. */
  update(id: string | number, body: string): Promise<string>;
  /** Create a comment, returning its id. */
  create(body: string): Promise<string>;
}

/** Dependencies for an idempotent review-comment upsert. */
export interface UpsertReviewCommentOptions {
  /** Canonical build/review URL — anchors the idempotency marker. */
  url: string;
  /** Markdown body appended below the marker. */
  markdown: string;
  /** Known thread number, skipping the lookup when provided. */
  prNumber?: number;
  /** Commit SHA used for the thread lookup and log context. */
  sha: string;
  logger?: Logger;
  /** Resolve the thread number for the commit (PR number or MR iid). */
  resolveNumber: () => Promise<number | undefined>;
  /** Open the thread's comment store once the number is known. */
  thread: (number: number) => ReviewThread;
}

/** Resolve the thread number, preferring the explicit value. */
async function resolveThreadNumber(opts: UpsertReviewCommentOptions): Promise<number | undefined> {
  return opts.prNumber ?? (await opts.resolveNumber());
}

/** Update the marked comment if present, else create it. */
async function findOrCreateComment(
  thread: ReviewThread,
  marker: string,
  body: string,
  prNumber: number,
  logger?: Logger,
): Promise<string> {
  const existing = (await thread.list()).find((comment) => comment.body.includes(marker));
  if (existing) {
    const id = await thread.update(existing.id, body);
    logger?.info({ prNumber, commentId: id }, "review comment updated");
    return id;
  }
  const id = await thread.create(body);
  logger?.info({ prNumber, commentId: id }, "review comment created");
  return id;
}

/**
 * Create or update the single StoryShelf review comment for a build,
 * idempotent via the url marker. Returns the comment id, or `""` when no
 * review thread exists for the commit.
 */
export async function upsertReviewComment(opts: UpsertReviewCommentOptions): Promise<string> {
  const marker = commentMarker(opts.url);
  const body = `${marker}\n${opts.markdown}`;
  const number = await resolveThreadNumber(opts);
  if (number === undefined) {
    opts.logger?.debug({ sha: opts.sha }, "no review thread found for comment, skipping");
    return "";
  }
  try {
    return await findOrCreateComment(opts.thread(number), marker, body, number, opts.logger);
  } catch (error) {
    opts.logger?.error({ err: error, prNumber: number }, "failed to upsert review comment");
    throw error;
  }
}
