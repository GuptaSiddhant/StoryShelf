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
