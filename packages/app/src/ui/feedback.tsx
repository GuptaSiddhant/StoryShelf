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
  if (isSuccessStatus(status)) {
    return "success";
  }
  if (isDangerStatus(status)) {
    return "danger";
  }
  if (isWarningStatus(status)) {
    return "warning";
  }
  if (isInfoStatus(status)) {
    return "info";
  }
  return "neutral";
}

function isSuccessStatus(status: string): boolean {
  return status === "approved" || status === "unchanged" || status === "completed";
}

function isDangerStatus(status: string): boolean {
  return status === "rejected" || status === "failed";
}

function isWarningStatus(status: string): boolean {
  return status === "changed" || status === "new" || status === "reviewing";
}

function isInfoStatus(status: string): boolean {
  return (
    status === "capturing" ||
    status === "comparing" ||
    status === "pending" ||
    status === "queued" ||
    status === "running"
  );
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

/** Badge, alert, and empty-state styles owned by this module. */
export function feedbackCss(): string {
  return `
    .badge { display: inline-flex; align-items: center; gap: .3rem; padding: .15rem .55rem; border-radius: 999px; font-size: .72rem; font-weight: 600; letter-spacing: .02em; border: 1px solid var(--border); background: var(--surface-muted); color: var(--text-secondary); white-space: nowrap; }
    .badge::before { content: ""; display: none; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
    .badge--dot::before { display: inline-block; }
    .badge--success { background: color-mix(in srgb, var(--status-approved) 12%, var(--surface-card)); color: var(--status-approved); border-color: color-mix(in srgb, var(--status-approved) 32%, var(--border)); }
    .badge--warning { background: color-mix(in srgb, var(--status-new) 12%, var(--surface-card)); color: var(--status-new); border-color: color-mix(in srgb, var(--status-new) 32%, var(--border)); }
    .badge--danger { background: color-mix(in srgb, var(--status-rejected) 12%, var(--surface-card)); color: var(--status-rejected); border-color: color-mix(in srgb, var(--status-rejected) 32%, var(--border)); }
    .badge--info { background: color-mix(in srgb, var(--accent) 9%, var(--surface-card)); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 28%, var(--border)); }
    .badge--neutral { background: var(--surface-muted); color: var(--text-secondary); }
    .alert { border-radius: var(--radius-sm); padding: .7rem .8rem; border: 1px solid var(--border); background: var(--surface-card); font-size: .875rem; }
    .alert--info { border-color: color-mix(in srgb, var(--accent) 25%, var(--border)); background: color-mix(in srgb, var(--accent) 6%, var(--surface-card)); }
    .alert--success { border-color: color-mix(in srgb, var(--status-approved) 25%, var(--border)); background: color-mix(in srgb, var(--status-approved) 6%, var(--surface-card)); }
    .alert--warning { border-color: color-mix(in srgb, var(--status-new) 25%, var(--border)); background: color-mix(in srgb, var(--status-new) 6%, var(--surface-card)); }
    .alert--danger { border-color: color-mix(in srgb, var(--status-rejected) 25%, var(--border)); background: color-mix(in srgb, var(--status-rejected) 6%, var(--surface-card)); }
    .alert__title { display: block; margin-bottom: .2rem; font-weight: 650; }
    .empty { text-align: center; padding: 2rem 1rem; border: 1px dashed var(--border); border-radius: var(--radius); background: var(--surface-card); }
    .empty__title { margin: 0 0 .3rem; font-size: 1.05rem; font-weight: 650; letter-spacing: -.01em; }
    .empty__desc { margin: 0 auto; color: var(--text-secondary); font-size: .875rem; max-width: 50ch; }
    .empty__action { margin-top: 1rem; }`;
}
