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
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
`;

export const snapshotCard = css`
  /* snapshot-card */
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
`;

export const snapshotCardHead = css`
  /* snapshot-card-head */
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
`;

export const snapshotCardMeta = css`
  /* snapshot-card-meta */
  font-size: 0.78rem;
  color: var(--text-secondary);
`;

export const snapshotCardBody = css`
  /* snapshot-card-body */
  padding: 0.5rem;
  display: grid;
  gap: 0.5rem;
`;

export const reviewComment = css`
  /* review-comment */
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  background: var(--surface-card);
`;

export const reviewCommentHead = css`
  /* review-comment-head */
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.82rem;
  color: var(--text-secondary);
  flex-wrap: wrap;
`;

export const reviewCommentBody = css`
  /* review-comment-body */
  margin: 0.5rem 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.875rem;
`;

export const reviewCommentActions = css`
  /* review-comment-actions */
  margin-top: 0.5rem;
`;
