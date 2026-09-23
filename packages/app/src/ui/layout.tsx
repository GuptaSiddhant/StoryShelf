import type { FC } from "hono/jsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Card container, padded by default. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Card: FC<{ children?: unknown; padded?: boolean }> = ({ children, padded = true }) => {
  return <div class={padded ? "card card--padded" : "card"}>{children}</div>;
};

/** Page header with breadcrumbs, title, description, and actions. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const PageHeader: FC<{
  title: string;
  description?: string;
  actions?: unknown;
  breadcrumbs?: { label: string; href?: string }[];
}> = ({ title, description, actions, breadcrumbs }) => {
  return (
    <div class="page-header">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav class="breadcrumbs" aria-label="Breadcrumb">
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
      <div class="page-header__row">
        <div>
          <h1 class="page-header__title">{title}</h1>
          {description ? <p class="page-header__desc">{description}</p> : null}
        </div>
        {actions ? <div class="page-header__actions">{actions}</div> : null}
      </div>
    </div>
  );
};

/** Card and page-header styles owned by this module. */
export function layoutCss(): string {
  return `
    .card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
    .card--padded { padding: 1rem; }
    .card--padded h2:first-child, .card--padded h3:first-child { margin: 0 0 .5rem; font-weight: 650; letter-spacing: -.01em; }
    .page-header { margin-bottom: 1.25rem; }
    .page-header__row { display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
    .page-header__title { margin: 0; font-size: 1.45rem; line-height: 1.2; letter-spacing: -0.02em; font-weight: 700; }
    .page-header__desc { margin: .35rem 0 0; color: var(--text-secondary); font-size: .9rem; max-width: 65ch; }
    .page-header__meta { margin: .4rem 0 0; color: var(--text-secondary); font-size: .82rem; display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; font-variant-numeric: tabular-nums; }
    .page-header__actions { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
    .breadcrumbs ol { list-style: none; padding: 0; margin: 0 0 .5rem; display: flex; gap: .4rem; flex-wrap: wrap; color: var(--text-secondary); font-size: .82rem; }
    .breadcrumbs li + li::before { content: "/"; margin-right: .4rem; color: var(--text-muted); }
    .breadcrumbs a { color: var(--text-secondary); }
    .breadcrumbs a:hover { color: var(--text-primary); }`;
}
