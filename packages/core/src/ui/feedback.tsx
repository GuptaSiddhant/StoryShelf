import type { FC } from "hono/jsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

/** Small status pill with a color tone. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Badge: FC<{ tone?: BadgeTone; children?: unknown }> = ({
  tone = "neutral",
  children,
}) => {
  return <span class={`badge badge--${tone}`}>{children}</span>;
};

/** Map a build or snapshot status string to its badge tone. */
export function statusTone(status: string): BadgeTone {
  if (status === "approved" || status === "unchanged") {
    return "success";
  }
  if (status === "rejected" || status === "failed") {
    return "danger";
  }
  if (status === "changed" || status === "new" || status === "reviewing") {
    return "warning";
  }
  if (status === "capturing" || status === "comparing" || status === "pending") {
    return "info";
  }
  return "neutral";
}

/** Alert banner with an optional title. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Alert: FC<{ tone?: BadgeTone; title?: string; children?: unknown }> = ({
  tone = "info",
  title,
  children,
}) => {
  return (
    <div class={`alert alert--${tone}`} role="alert">
      {title ? <strong class="alert__title">{title}</strong> : null}
      <div class="alert__body">{children}</div>
    </div>
  );
};

/** Centered empty state with an optional call-to-action. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const EmptyState: FC<{ title: string; description?: string; action?: unknown }> = ({
  title,
  description,
  action,
}) => {
  return (
    <div class="empty">
      <h2 class="empty__title">{title}</h2>
      {description ? <p class="empty__desc">{description}</p> : null}
      {action ? <div class="empty__action">{action}</div> : null}
    </div>
  );
};

/** Centered statistic value with a label. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Stat: FC<{ label: string; value: string | number }> = ({ label, value }) => {
  return (
    <div class="stat">
      <div class="stat__value">{String(value)}</div>
      <div class="stat__label">{label}</div>
    </div>
  );
};
