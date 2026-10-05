import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";
import type { IconName } from "./icons/paths.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";
type StatTone = "neutral" | "success" | "warning";

const badgeBase = css`
  /* badge */
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.55rem;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.5;
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
    background: var(--status-approved-bg);
    color: var(--status-approved);
    border-color: var(--status-approved-border);
  `,
  warning: css`
    /* badge-warning */
    ${badgeBase}
    background: var(--status-new-bg);
    color: var(--status-new);
    border-color: var(--status-new-border);
  `,
  danger: css`
    /* badge-danger */
    ${badgeBase}
    background: var(--status-rejected-bg);
    color: var(--status-rejected);
    border-color: var(--status-rejected-border);
  `,
  info: css`
    /* badge-info */
    ${badgeBase}
    background: var(--status-info-bg);
    color: var(--accent-fg);
    border-color: var(--status-info-border);
  `,
};

/** Status glyph per tone so state never relies on color alone. */
const toneIcons: Record<BadgeTone, IconName> = {
  neutral: "info",
  success: "check-circle",
  warning: "alert-triangle",
  danger: "x-circle",
  info: "info",
};

const alertBase = css`
  /* alert */
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  border-radius: var(--radius);
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border);
  background: var(--surface-card);
  font-size: var(--text-base);
`;

const alertTones: Record<BadgeTone, Promise<string>> = {
  neutral: css`
    /* alert-neutral */
    ${alertBase}
  `,
  info: css`
    /* alert-info */
    ${alertBase}
    border-color: var(--status-info-border);
    background: var(--status-info-bg);
  `,
  success: css`
    /* alert-success */
    ${alertBase}
    border-color: var(--status-approved-border);
    background: var(--status-approved-bg);
  `,
  warning: css`
    /* alert-warning */
    ${alertBase}
    border-color: var(--status-new-border);
    background: var(--status-new-bg);
  `,
  danger: css`
    /* alert-danger */
    ${alertBase}
    border-color: var(--status-rejected-border);
    background: var(--status-rejected-bg);
  `,
};

const alertIconTones: Record<BadgeTone, Promise<string>> = {
  neutral: css`
    /* alert-icon-neutral */
    margin-top: 0.1rem;
    color: var(--text-secondary);
  `,
  info: css`
    /* alert-icon-info */
    margin-top: 0.1rem;
    color: var(--accent-fg);
  `,
  success: css`
    /* alert-icon-success */
    margin-top: 0.1rem;
    color: var(--status-approved);
  `,
  warning: css`
    /* alert-icon-warning */
    margin-top: 0.1rem;
    color: var(--status-new);
  `,
  danger: css`
    /* alert-icon-danger */
    margin-top: 0.1rem;
    color: var(--status-rejected);
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

const metaText = css`
  /* meta */
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
`;

const metaMono = css`
  /* meta-mono */
  ${metaText}
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;

const metaCode = css`
  /* meta-code */
  ${metaMono}
  font-size: 0.85em;
`;

const metaPre = css`
  /* meta-pre */
  ${metaMono}
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
  font-size: 0.8rem;
  overflow: auto;
`;

const metaDanger = css`
  /* meta-danger */
  ${metaText}
  color: var(--status-rejected);
`;

const metaCenter = css`
  /* meta-center */
  ${metaText}
  text-align: center;
`;

type MetaAs = "p" | "span" | "div" | "code" | "pre";
type MetaTone = "neutral" | "danger";

/** Small status pill with a color tone. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Badge: FC<{ tone?: BadgeTone; icon?: boolean; children?: unknown }> = ({
  tone = "neutral",
  icon = false,
  children,
}) => {
  return (
    <span class={badgeTones[tone]}>
      {icon ? <Icon name={toneIcons[tone]} size="sm" /> : null}
      {children}
    </span>
  );
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
      <span class={alertIconTones[tone]}>
        <Icon name={toneIcons[tone]} />
      </span>
      <div>
        {title ? <strong class={alertTitle}>{title}</strong> : null}
        <div>{children}</div>
      </div>
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

/** Muted secondary text for metadata and descriptions (not a form hint). */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Meta: FC<{
  as?: MetaAs;
  mono?: boolean;
  tone?: MetaTone;
  center?: boolean;
  children?: unknown;
}> = ({ as = "p", mono = false, tone = "neutral", center = false, children }) => {
  const cls =
    as === "pre"
      ? metaPre
      : as === "code"
        ? metaCode
        : tone === "danger"
          ? metaDanger
          : center
            ? metaCenter
            : mono
              ? metaMono
              : metaText;
  if (as === "span") {
    return <span class={cls}>{children}</span>;
  }
  if (as === "div") {
    return <div class={cls}>{children}</div>;
  }
  if (as === "code") {
    return <code class={cls}>{children}</code>;
  }
  if (as === "pre") {
    return <pre class={cls}>{children}</pre>;
  }
  return <p class={cls}>{children}</p>;
};
