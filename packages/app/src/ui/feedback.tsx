import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";
type StatTone = "neutral" | "success" | "warning";

const badgeBase = css`
  /* badge */
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid var(--border);
  background: var(--surface-muted);
  color: var(--text-secondary);
  white-space: nowrap;
`;

const badgeTones: Record<BadgeTone, Promise<string>> = {
  neutral: css`
    /* badge-neutral */
    ${badgeBase}
  `,
  success: css`
    /* badge-success */
    ${badgeBase}
    background: color-mix(in srgb, var(--status-approved) 12%, var(--surface-card));
    color: var(--status-approved);
    border-color: color-mix(in srgb, var(--status-approved) 32%, var(--border));
  `,
  warning: css`
    /* badge-warning */
    ${badgeBase}
    background: color-mix(in srgb, var(--status-new) 12%, var(--surface-card));
    color: var(--status-new);
    border-color: color-mix(in srgb, var(--status-new) 32%, var(--border));
  `,
  danger: css`
    /* badge-danger */
    ${badgeBase}
    background: color-mix(in srgb, var(--status-rejected) 12%, var(--surface-card));
    color: var(--status-rejected);
    border-color: color-mix(in srgb, var(--status-rejected) 32%, var(--border));
  `,
  info: css`
    /* badge-info */
    ${badgeBase}
    background: color-mix(in srgb, var(--accent) 9%, var(--surface-card));
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  `,
};

const alertBase = css`
  /* alert */
  border-radius: var(--radius-sm);
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--border);
  background: var(--surface-card);
  font-size: 0.875rem;
`;

const alertTones: Record<BadgeTone, Promise<string>> = {
  neutral: css`
    /* alert-neutral */
    ${alertBase}
  `,
  info: css`
    /* alert-info */
    ${alertBase}
    border-color: color-mix(in srgb, var(--accent) 25%, var(--border));
    background: color-mix(in srgb, var(--accent) 6%, var(--surface-card));
  `,
  success: css`
    /* alert-success */
    ${alertBase}
    border-color: color-mix(in srgb, var(--status-approved) 25%, var(--border));
    background: color-mix(in srgb, var(--status-approved) 6%, var(--surface-card));
  `,
  warning: css`
    /* alert-warning */
    ${alertBase}
    border-color: color-mix(in srgb, var(--status-new) 25%, var(--border));
    background: color-mix(in srgb, var(--status-new) 6%, var(--surface-card));
  `,
  danger: css`
    /* alert-danger */
    ${alertBase}
    border-color: color-mix(in srgb, var(--status-rejected) 25%, var(--border));
    background: color-mix(in srgb, var(--status-rejected) 6%, var(--surface-card));
  `,
};

const emptyWrap = css`
  /* empty */
  text-align: center;
  padding: 2rem 1rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface-card);
`;

const emptyTitle = css`
  /* empty-title */
  margin: 0 0 0.3rem;
  font-size: 1.05rem;
  font-weight: 650;
  letter-spacing: -0.01em;
`;

const emptyDesc = css`
  /* empty-desc */
  margin: 0 auto;
  color: var(--text-secondary);
  font-size: 0.875rem;
  max-width: 50ch;
`;

const emptyAction = css`
  /* empty-action */
  margin-top: 1rem;
`;

const statWrap = css`
  /* stat */
  text-align: center;
  padding: 0.5rem;
`;

const statValueBase = css`
  /* stat-value */
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
`;

const statValueTones: Record<StatTone, Promise<string>> = {
  neutral: css`
    /* stat-value-neutral */
    ${statValueBase}
  `,
  success: css`
    /* stat-value-success */
    ${statValueBase}
    color: var(--status-approved);
  `,
  warning: css`
    /* stat-value-warning */
    ${statValueBase}
    color: var(--status-new);
  `,
};

const statLabel = css`
  /* stat-label */
  color: var(--text-secondary);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

/** Small status pill with a color tone. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Badge: FC<{ tone?: BadgeTone; children?: unknown }> = ({
  tone = "neutral",
  children,
}) => {
  return <span class={badgeTones[tone]}>{children}</span>;
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
    <div class={alertTones[tone]} role="alert">
      {title ? <strong class={alertTitle}>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
};

const alertTitle = css`
  /* alert-title */
  display: block;
  margin-bottom: 0.2rem;
  font-weight: 650;
`;

/** Centered empty state with an optional title and call-to-action. */ // eslint-disable-next-line promise-function-async -- JSX component return type
export const EmptyState: FC<{ title?: string; description?: string; action?: unknown }> = ({
  title,
  description,
  action,
}) => {
  return (
    <div class={emptyWrap}>
      {title ? <h2 class={emptyTitle}>{title}</h2> : null}
      {description ? <p class={emptyDesc}>{description}</p> : null}
      {action ? <div class={emptyAction}>{action}</div> : null}
    </div>
  );
};

/** Centered statistic value with a label and an optional value tone. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Stat: FC<{ label: string; value: string | number; tone?: StatTone }> = ({
  label,
  value,
  tone = "neutral",
}) => {
  return (
    <div class={statWrap}>
      <div class={statValueTones[tone]}>{String(value)}</div>
      <div class={statLabel}>{label}</div>
    </div>
  );
};
