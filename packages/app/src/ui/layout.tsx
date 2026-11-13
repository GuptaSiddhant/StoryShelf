import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";
import type { IconName } from "./icons/paths.ts";
const cardBase = css`
  /* card */
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
`;

const cardColumn = css`
  /* card-column */
  ${cardBase}
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const cardPadded = css`
  /* card-padded */
  ${cardBase}
  padding: 1rem;
`;

const cardDanger = css`
  /* card-danger */
  ${cardPadded}
  border-color: var(--status-rejected);
`;

const cardSection = css`
  /* card-section */
  padding: 1rem;
`;

const cardSectionDivider = css`
  /* card-section-divider */
  ${cardSection}
  border-bottom: 1px solid var(--border);
`;

const pageHeader = css`
  /* page-header */
  margin-bottom: 1.25rem;
`;

const pageHeaderRow = css`
  /* page-header-row */
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
`;

const pageHeaderTitle = css`
  /* page-header-title */
  margin: 0;
  font-size: 1.45rem;
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
`;

const pageHeaderDesc = css`
  /* page-header-desc */
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
  max-width: 65ch;
  /* Links inside running text must not rely on colour alone. */
  & a {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
`;

const pageHeaderMeta = css`
  /* page-header-meta */
  margin: 0.4rem 0 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
`;

const pageHeaderActions = css`
  /* page-header-actions */
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
`;

const sectionTitleH2 = css`
  /* section-title */
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  font-weight: 650;
  letter-spacing: -0.01em;
`;

const sectionTitleH3 = css`
  /* section-title-sm */
  ${sectionTitleH2}
  font-size: 0.95rem;
`;

const sectionTitleDanger = css`
  /* section-title-danger */
  ${sectionTitleH3}
  color: var(--status-rejected);
`;

/** Card or section heading (h2 by default, h3 for subsections). */

/** Card container, padded by default, with an optional danger tone. */
export const Card: FC<{
  children?: unknown;
  padded?: boolean;
  tone?: "neutral" | "danger";
  /** Flex column filling its grid cell, so a footer can sit at the bottom of equal-height cards. */
  fill?: boolean;
  [key: string]: unknown;
}> = ({ children, padded = true, tone = "neutral", fill = false, ...rest }) => {
  if (fill) {
    return (
      <div class={cardColumn} {...rest}>
        {children}
      </div>
    );
  }
  if (!padded) {
    return (
      <div class={cardBase} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <div class={tone === "danger" ? cardDanger : cardPadded} {...rest}>
      {children}
    </div>
  );
};

/** Padded card section, with an optional bottom divider. */
export const CardSection: FC<{ divider?: boolean; children?: unknown }> = ({
  divider = false,
  children,
}) => {
  return <div class={divider ? cardSectionDivider : cardSection}>{children}</div>;
};

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const stripBase = css`
  /* status-strip */
  display: grid;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-left: 3px solid var(--text-muted);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
`;
const stripEdge: Record<StatusTone, Promise<string>> = {
  neutral: stripBase,
  success: css`
    /* status-strip-success */
    ${stripBase}
    border-left-color: var(--status-approved);
  `,
  warning: css`
    /* status-strip-warning */
    ${stripBase}
    border-left-color: var(--status-new);
  `,
  danger: css`
    /* status-strip-danger */
    ${stripBase}
    border-left-color: var(--status-rejected);
  `,
  info: css`
    /* status-strip-info */
    ${stripBase}
    border-left-color: var(--status-info);
  `,
};
const stripRow = css`
  /* status-strip-row */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  justify-content: space-between;
  min-width: 0;
`;
const stripTitle = css`
  /* status-strip-title */
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: var(--leading-tight);
`;
const stripMeta = css`
  /* status-strip-meta */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
`;
const stripDetail = css`
  /* status-strip-detail */
  flex: 1 1 16rem;
  min-width: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
`;

/** The status strip: a 3 px status-coloured edge, the status as the heading, one primary action. */
const StatusStrip: FC<{
  title: unknown;
  meta?: unknown;
  detail?: unknown;
  actions?: unknown;
  status: { tone: StatusTone; icon?: IconName };
  id?: string;
  oob?: boolean;
}> = ({ title, meta, detail, actions, status, id, oob }) => (
  <header class={stripEdge[status.tone]} id={id} hx-swap-oob={oob ? "true" : undefined}>
    <div class={stripRow}>
      <h1 class={stripTitle}>
        {status.icon ? <Icon name={status.icon} /> : null}
        {title}
      </h1>
      {meta ? <p class={stripMeta}>{meta}</p> : null}
    </div>
    {detail || actions ? (
      <div class={stripRow}>
        <div class={stripDetail}>{detail}</div>
        {actions ? <div class={pageHeaderActions}>{actions}</div> : null}
      </div>
    ) : null}
  </header>
);

/**
 * Page header with title, description, meta line, and actions (breadcrumbs live in the top bar).
 * With `status` it becomes the status strip: the title is the status, `detail` is the line under it
 * (progress, or the reason), and `actions` hold the one primary button.
 */
export const PageHeader: FC<{
  title: unknown;
  description?: unknown;
  meta?: unknown;
  actions?: unknown;
  /** `2` for a section header on a page whose own heading is the h1 (one h1 per page). */
  level?: 1 | 2;
  /** Renders the status-strip variant, edged in the tone's colour. */
  status?: { tone: StatusTone; icon?: IconName };
  /** Status strip only: the second line (progress bar or failure reason). */
  detail?: unknown;
  /** Status strip only: an element id, so an HTMX swap can find the header. */
  id?: string;
  /** Status strip only: mark the header for an out-of-band swap. */
  oob?: boolean;
}> = ({ title, description, meta, actions, level = 1, status, detail, id, oob }) => {
  if (status) {
    return (
      <StatusStrip
        title={title}
        meta={meta}
        detail={detail}
        actions={actions}
        status={status}
        id={id}
        oob={oob}
      />
    );
  }
  return (
    <div class={pageHeader}>
      <div class={pageHeaderRow}>
        <div>
          {level === 1 ? (
            <h1 class={pageHeaderTitle}>{title}</h1>
          ) : (
            <h2 class={pageHeaderTitle}>{title}</h2>
          )}
          {description ? <p class={pageHeaderDesc}>{description}</p> : null}
          {meta ? <p class={pageHeaderMeta}>{meta}</p> : null}
        </div>
        {actions ? <div class={pageHeaderActions}>{actions}</div> : null}
      </div>
    </div>
  );
};

/** Card or section heading (h2 by default, h3 for subsections). */
export const SectionTitle: FC<{
  level?: 2 | 3;
  tone?: "neutral" | "danger";
  children?: unknown;
}> = ({ level = 2, tone = "neutral", children }) => {
  if (level === 3) {
    return <h3 class={tone === "danger" ? sectionTitleDanger : sectionTitleH3}>{children}</h3>;
  }
  return <h2 class={sectionTitleH2}>{children}</h2>;
};
