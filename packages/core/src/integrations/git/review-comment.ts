import type { Logger } from "../../logger.ts";
import { buildMarker, commentBuildId, commentMarker, legacyCommentPrefix } from "./describe.ts";

/** A review thread (PR or MR) hosting a single StoryShelf comment. */
export interface ReviewThread {
  /** List existing comments as id/body pairs. */
  list(): Promise<{ id: string | number; body: string }[]>;
  /** Replace the body of an existing comment, returning its id. */
  update(id: string | number, body: string): Promise<string>;
  /** Create a comment, returning its id. */
  create(body: string): Promise<string>;
}

/** Comments per request, the largest page both hosts allow. */
export const PAGE_SIZE = 100;
/** Pages read at most (10 000 comments): a bound on a thread that never ends. */
const MAX_PAGES = 100;

/** Read pages 1, 2, … until one comes back short or empty. */
export async function listAllPages<T>(
  fetchPage: (page: number) => Promise<T[]>,
  page = 1,
): Promise<T[]> {
  const items = await fetchPage(page);
  if (items.length < PAGE_SIZE || page >= MAX_PAGES) {
    return items;
  }
  return [...items, ...(await listAllPages(fetchPage, page + 1))];
}

/** What identifies the comment to write. */
export interface CommentInput {
  sha: string;
  project: string;
  buildId: string;
  url: string;
  markdown: string;
}

/** Dependencies for an idempotent review-comment upsert. */
export interface UpsertReviewCommentOptions {
  /** Project slug: keys the one comment per pull request and project. */
  project: string;
  /** The build whose state this is; an older build never overwrites a newer one's comment. */
  buildId: string;
  /** The build page; only its project part is used, to adopt a pre-upgrade per-build comment. */
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

type Listed = { id: string | number; body: string };

/** The project's comment, else the newest pre-upgrade per-build comment of the project. */
function findComment(comments: Listed[], marker: string, legacyPrefix: string): Listed | undefined {
  return (
    comments.find((comment) => comment.body.includes(marker)) ??
    comments.findLast((comment) => comment.body.startsWith(legacyPrefix))
  );
}

/** Update the project's comment unless a newer build wrote it, else create it. */
async function findOrCreateComment(
  thread: ReviewThread,
  opts: UpsertReviewCommentOptions,
  body: string,
  prNumber: number,
): Promise<string> {
  const marker = commentMarker(opts.project);
  const existing = findComment(await thread.list(), marker, legacyCommentPrefix(opts.url));
  const written = existing === undefined ? undefined : commentBuildId(existing.body);
  if (existing && written !== undefined && written > opts.buildId) {
    opts.logger?.info({ prNumber, buildId: opts.buildId }, "review comment kept: newer build");
    return String(existing.id);
  }
  const id = existing ? await thread.update(existing.id, body) : await thread.create(body);
  opts.logger?.info(
    { prNumber, commentId: id },
    existing ? "review comment updated" : "review comment created",
  );
  return id;
}

/**
 * Create or update the single StoryShelf review comment of a project on a pull request,
 * idempotent via the project marker; the newest build wins. Returns the comment id, or `""` when no
 * review thread exists for the commit.
 */
export async function upsertReviewComment(opts: UpsertReviewCommentOptions): Promise<string> {
  const body = `${commentMarker(opts.project)}\n${buildMarker(opts.buildId)}\n${opts.markdown}`;
  const number = await resolveThreadNumber(opts);
  if (number === undefined) {
    opts.logger?.debug({ sha: opts.sha }, "no review thread found for comment, skipping");
    return "";
  }
  try {
    return await findOrCreateComment(opts.thread(number), opts, body, number);
  } catch (error) {
    opts.logger?.error({ err: error, prNumber: number }, "failed to upsert review comment");
    throw error;
  }
}
