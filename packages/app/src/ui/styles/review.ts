/**
 * Snapshot-card and comment styles shared by the build detail, library, and
 * review pages (the review workspace layout lives in `review-layout.ts`).
 * Shared across pages, so they live here rather than colocated in one file —
 * the documented exception to colocation (see the `ui-building-blocks`
 * skill). Labels keep class names readable.
 */
import { css } from "../css.ts";

export const diffPaneImg = css`
  /* diff-pane-img */
  display: block;
  width: 100%;
  height: auto;
  background: repeating-conic-gradient(var(--surface-muted) 0% 25%, var(--surface-subtle) 0% 50%) 0
    0 / 16px 16px;
`;

export const snapshotGrid = css`
  /* snapshot-grid */
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
`;

export const snapshotCard = css`
  /* snapshot-card */
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
`;

export const snapshotCardHead = css`
  /* snapshot-card-head */
  padding: var(--space-3) var(--space-3);
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  align-items: center;
`;

export const snapshotCardMeta = css`
  /* snapshot-card-meta */
  font-size: var(--text-xs);
  color: var(--text-secondary);
`;

export const snapshotCardBody = css`
  /* snapshot-card-body */
  padding: var(--space-2);
  display: grid;
  gap: var(--space-2);
`;

export const reviewComment = css`
  /* review-comment */
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-3);
  background: var(--surface-card);
`;

export const reviewCommentHead = css`
  /* review-comment-head */
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  flex-wrap: wrap;
`;

export const reviewCommentBody = css`
  /* review-comment-body */
  margin: var(--space-2) 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--text-base);
`;

/** An `@mention` of a project member inside a comment body (#463). */
export const reviewMention = css`
  /* review-mention */
  background: var(--accent-subtle);
  color: var(--text-primary);
  border-radius: 0.25rem;
  padding: 0 var(--space-1);
  font-weight: var(--weight-semibold);
`;

export const reviewCommentActions = css`
  /* review-comment-actions */
  margin-top: var(--space-2);
`;
