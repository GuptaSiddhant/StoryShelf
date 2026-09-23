/**
 * Shared review-surface styles (hono/css, collected per render).
 *
 * These patterns are shared across pages (build detail, library, and the
 * diff sections), so they live here rather than colocated in one file —
 * the single documented exception to colocation (see the
 * `ui-building-blocks` skill). Labels keep class names readable.
 */
import { css } from "../css.ts";

export const reviewLayout = css`
  /* review-layout */
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  @media (max-width: 1024px) {
    & {
      flex-direction: column;
    }
  }
`;

export const reviewNav = css`
  /* review-nav */
  flex: 0 0 300px;
  max-width: 34%;
  min-width: 250px;
  @media (max-width: 1024px) {
    & {
      flex: auto;
      max-width: none;
      min-width: 0;
      width: 100%;
    }
  }
`;

export const reviewNavHead = css`
  /* review-nav-head */
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

export const reviewNavList = css`
  /* review-nav-list */
  max-height: 70vh;
  overflow: auto;
  @media (max-width: 1024px) {
    & {
      max-height: 240px;
    }
  }
`;

export const snapshotNav = css`
  /* snapshot-nav */
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  text-decoration: none;
  color: inherit;
  &:hover {
    background: var(--surface-subtle);
    text-decoration: none;
  }
`;

export const snapshotNavActive = css`
  /* snapshot-nav-active */
  ${snapshotNav}
  background: var(--surface-muted);
  border-left: 3px solid var(--accent);
  padding-left: calc(0.75rem - 3px);
`;

export const snapshotNavTitle = css`
  /* snapshot-nav-title */
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
  font-weight: 600;
  font-size: 0.875rem;
`;

export const snapshotNavMeta = css`
  /* snapshot-nav-meta */
  font-size: 0.78rem;
  color: var(--text-secondary);
`;

export const reviewMain = css`
  /* review-main */
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 1rem;
  align-content: start;
`;

export const reviewBar = css`
  /* review-bar */
  position: sticky;
  top: 52px;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
  padding: 0.625rem 0.75rem;
  margin: -0.25rem -0.25rem 0.75rem;
  background: color-mix(in srgb, var(--surface-card) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  border-radius: var(--radius-sm);
`;

export const reviewBarTitle = css`
  /* review-bar-title */
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.01em;
`;

export const reviewBarMeta = css`
  /* review-bar-meta */
  margin: 0.15rem 0 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
`;

export const viewSwitch = css`
  /* view-switch */
  display: inline-flex;
  padding: 2px;
  gap: 1px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
  & button {
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    border-radius: calc(var(--radius-sm) - 2px);
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    min-height: 32px;
  }
  & button[aria-pressed="true"] {
    background: var(--surface-card);
    color: var(--text-primary);
    border-color: var(--border);
    box-shadow: var(--shadow);
  }
`;

export const diffGrid = css`
  /* diff-grid */
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  &[data-view="baseline"] [data-pane]:not([data-pane="baseline"]) {
    display: none;
  }
  &[data-view="current"] [data-pane]:not([data-pane="current"]) {
    display: none;
  }
  &[data-view="diff"] [data-pane]:not([data-pane="diff"]) {
    display: none;
  }
  &[data-view="baseline"],
  &[data-view="current"],
  &[data-view="diff"] {
    grid-template-columns: minmax(0, 1fr);
  }
  &[data-view="baseline"] [data-pane] img,
  &[data-view="current"] [data-pane] img,
  &[data-view="diff"] [data-pane] img {
    max-height: 70vh;
    object-fit: contain;
    background: var(--surface-subtle);
  }
  @media (max-width: 900px) {
    &[data-view="split"] {
      grid-template-columns: 1fr;
    }
  }
`;

export const diffPane = css`
  /* diff-pane */
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-card);
`;

export const diffPaneLabel = css`
  /* diff-pane-label */
  padding: 0.4rem 0.6rem;
  font-weight: 600;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

export const diffPaneImg = css`
  /* diff-pane-img */
  display: block;
  width: 100%;
  height: auto;
  background: repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%) 0 0 / 16px 16px;
`;

export const diffPlaceholder = css`
  /* diff-placeholder */
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  gap: 0.25rem;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 0.85rem;
  text-align: center;
  padding: 1rem;
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
