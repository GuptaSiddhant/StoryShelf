/**
 * Review workspace layout styles: header, filmstrip, canvas column, action
 * bar, and shortcuts dialog. Shared by the `build-diff-*` page sections, so
 * they live here (the documented exception to colocation).
 */
import { css } from "../css.ts";

export const workspace = css`
  /* review-workspace */
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
  @media (max-width: 1024px) {
    & {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`;

export const canvasColumn = css`
  /* review-canvas */
  display: grid;
  gap: var(--space-4);
  min-width: 0;
`;

/* ---- header ---- */

export const reviewHeader = css`
  /* review-header */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--space-4);
  padding: var(--space-4);
  background: linear-gradient(var(--accent-wash), var(--accent-wash)), var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
`;

export const headerMain = css`
  /* review-header-main */
  display: grid;
  gap: var(--space-1);
  min-width: 0;
`;

export const headerTitle = css`
  /* review-header-title */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
`;

export const headerMeta = css`
  /* review-header-meta */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
`;

export const headerSide = css`
  /* review-header-side */
  display: grid;
  gap: var(--space-3);
  justify-items: end;
  min-width: min(100%, 280px);
  @media (max-width: 720px) {
    & {
      justify-items: stretch;
      width: 100%;
    }
  }
`;

export const headerProgress = css`
  /* review-header-progress */
  display: grid;
  gap: var(--space-1);
  width: 100%;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
`;

export const headerActions = css`
  /* review-header-actions */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
`;

/* ---- filmstrip ---- */

export const filmstrip = css`
  /* filmstrip */
  position: sticky;
  top: calc(var(--topbar-height) + var(--space-4));
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - var(--topbar-height) - var(--space-8) - var(--space-4));
  overflow: hidden;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  @media (max-width: 1024px) {
    & {
      position: static;
      max-height: 320px;
    }
  }
`;

export const filmstripHead = css`
  /* filmstrip-head */
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
`;

export const filmstripList = css`
  /* filmstrip-list */
  overflow: auto;
  overscroll-behavior: contain;
`;

export const filmItem = css`
  /* film-item */
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  border-left: 3px solid transparent;
  color: inherit;
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease);
  &:hover {
    background: var(--surface-subtle);
    text-decoration: none;
  }
`;

export const filmItemActive = css`
  /* film-item-active */
  ${filmItem}
  background: var(--accent-subtle);
  border-left-color: var(--accent);
  &:hover {
    background: var(--accent-subtle);
  }
`;

export const filmBody = css`
  /* film-body */
  display: grid;
  gap: 2px;
  min-width: 0;
`;

export const filmTitle = css`
  /* film-title */
  overflow: hidden;
  font-size: var(--text-base);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const filmSub = css`
  /* film-sub */
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const filmStatus = css`
  /* film-status */
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  font-size: var(--text-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

const dot = css`
  /* status-dot */
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--text-muted);
`;

export const statusDots = {
  neutral: dot,
  success: css`
    /* status-dot-success */
    ${dot}
    background: var(--status-approved);
  `,
  warning: css`
    /* status-dot-warning */
    ${dot}
    background: var(--status-new);
  `,
  danger: css`
    /* status-dot-danger */
    ${dot}
    background: var(--status-rejected);
  `,
  info: css`
    /* status-dot-info */
    ${dot}
    background: var(--status-info);
  `,
};

/* ---- viewer ---- */

export const viewerHead = css`
  /* viewer-head */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: baseline;
  justify-content: space-between;
`;

export const viewerTitle = css`
  /* viewer-title */
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 650;
  letter-spacing: -0.01em;
`;

export const viewerMeta = css`
  /* viewer-meta */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
`;

/* ---- action bar ---- */

export const actionBar = css`
  /* review-action-bar */
  position: sticky;
  bottom: var(--space-4);
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  background: color-mix(in srgb, var(--surface-card) 92%, transparent);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2);
`;

export const actionGroup = css`
  /* review-action-group */
  display: flex;
  gap: var(--space-2);
  align-items: center;
`;

export const actionPosition = css`
  /* review-action-position */
  min-width: 4.5rem;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  text-align: center;
`;

export const actionHints = css`
  /* review-action-hints */
  display: flex;
  gap: var(--space-2);
  align-items: center;
  color: var(--text-muted);
  font-size: var(--text-xs);
  @media (max-width: 720px) {
    & {
      display: none;
    }
  }
`;

/* ---- shortcuts dialog ---- */

export const shortcutsDialog = css`
  /* shortcuts-dialog */
  width: min(440px, calc(100vw - 2rem));
  padding: var(--space-5);
  color: var(--text-primary);
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-3);
  &::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-lg);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0 0 var(--space-4);
    font-size: var(--text-base);
  }
  dt {
    display: flex;
    gap: var(--space-1);
  }
  dd {
    margin: 0;
    color: var(--text-secondary);
  }
`;
