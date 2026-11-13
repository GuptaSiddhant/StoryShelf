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

/**
 * The comparison card: heading, stage and, as its footer, the action bar. No overflow clipping, so
 * the footer can stay docked at the bottom of the viewport while the card is in view.
 */
export const comparisonCard = css`
  /* review-comparison-card */
  display: grid;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-4) var(--space-4) 0;
  background: var(--surface-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  @media (max-width: 720px) {
    & {
      padding: var(--space-3) var(--space-3) 0;
    }
  }
`;

/* ---- header ---- */

export const headerProgress = css`
  /* review-header-progress */
  display: grid;
  gap: var(--space-1);
  width: 100%;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
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
      max-height: none;
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
  @media (max-width: 1024px) {
    & {
      display: flex;
      overflow-x: auto;
      overflow-y: hidden;
    }
  }
`;

export const filmGroup = css`
  /* film-group */
  display: block;
  @media (max-width: 1024px) {
    & {
      display: contents;
    }
  }
`;

export const filmGroupHead = css`
  /* film-group-head */
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  @media (max-width: 1024px) {
    & {
      flex: none;
      align-items: center;
      max-width: 160px;
      border-bottom: 0;
      border-right: 1px solid var(--border-subtle);
      white-space: nowrap;
    }
    & > :first-child {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
`;

export const filmItem = css`
  /* film-item */
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  border-left: 3px solid transparent;
  color: inherit;
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease);
  &:hover {
    background: var(--surface-subtle);
    text-decoration: none;
  }
  &[data-status="approved"],
  &[data-status="rejected"] {
    color: var(--text-secondary);
  }
  @media (max-width: 1024px) {
    & {
      flex: none;
      width: 240px;
      border-bottom: 0;
      border-left: 0;
      border-right: 1px solid var(--border-subtle);
      border-top: 3px solid transparent;
    }
  }
`;

export const filmItemActive = css`
  /* film-item-active */
  ${filmItem}
  background: var(--accent-wash);
  border-left-color: var(--accent);
  &:hover {
    background: var(--accent-wash);
  }
  @media (max-width: 1024px) {
    & {
      border-left-color: transparent;
      border-top-color: var(--accent);
    }
  }
`;

export const filmTitle = css`
  /* film-title */
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const filmStatus = css`
  /* film-status */
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
  bottom: 0;
  z-index: 20;
  display: flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  margin: 0 calc(var(--space-4) * -1);
  padding: var(--space-2) var(--space-4);
  background: var(--surface-card);
  border-top: 1px solid var(--border-subtle);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  @media (max-width: 720px) {
    & {
      margin: 0 calc(var(--space-3) * -1);
      padding: var(--space-2) var(--space-3);
    }
  }
`;

export const actionGroup = css`
  /* review-action-group */
  display: flex;
  gap: var(--space-2);
  align-items: center;
  @media (max-width: 480px) {
    & {
      gap: var(--space-1);
    }
  }
`;

export const actionPosition = css`
  /* review-action-position */
  min-width: 3.5rem;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  text-align: center;
`;

/** The shortcuts button: keyboard help is for keyboards, so a phone-width bar drops it. */
export const actionHints = css`
  /* review-action-hints */
  display: flex;
  align-items: center;
  @media (max-width: 480px) {
    & {
      display: none;
    }
  }
`;

/** A key hint inside a button ("Approve a"); hidden on narrow screens, where it rarely applies. */
export const actionKey = css`
  /* review-action-key */
  display: inline-flex;
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
