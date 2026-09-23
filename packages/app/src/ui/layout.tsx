import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const cardBase = css`
  /* card */
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
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

const crumbsNav = css`
  /* breadcrumbs */
  & ol {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem;
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    color: var(--text-secondary);
    font-size: 0.82rem;
  }
  & li + li::before {
    content: "/";
    margin-right: 0.4rem;
    color: var(--text-muted);
  }
  & a {
    color: var(--text-secondary);
  }
  & a:hover {
    color: var(--text-primary);
  }
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
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Card: FC<{
  children?: unknown;
  padded?: boolean;
  tone?: "neutral" | "danger";
  [key: string]: unknown;
}> = ({ children, padded = true, tone = "neutral", ...rest }) => {
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
// eslint-disable-next-line promise-function-async -- JSX component return type
export const CardSection: FC<{ divider?: boolean; children?: unknown }> = ({
  divider = false,
  children,
}) => {
  return <div class={divider ? cardSectionDivider : cardSection}>{children}</div>;
};

/** Page header with breadcrumbs, title, description, meta line, and actions. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const PageHeader: FC<{
  title: unknown;
  description?: unknown;
  meta?: unknown;
  actions?: unknown;
  breadcrumbs?: { label: string; href?: string }[];
}> = ({ title, description, meta, actions, breadcrumbs }) => {
  return (
    <div class={pageHeader}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav class={crumbsNav} aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((crumb, index) => (
              <li key={String(index)}>
                {crumb.href ? (
                  <a href={crumb.href}>{crumb.label}</a>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div class={pageHeaderRow}>
        <div>
          <h1 class={pageHeaderTitle}>{title}</h1>
          {description ? <p class={pageHeaderDesc}>{description}</p> : null}
          {meta ? <p class={pageHeaderMeta}>{meta}</p> : null}
        </div>
        {actions ? <div class={pageHeaderActions}>{actions}</div> : null}
      </div>
    </div>
  );
};

/** Card or section heading (h2 by default, h3 for subsections). */
// eslint-disable-next-line promise-function-async -- JSX component return type
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
