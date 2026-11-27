import type { FC } from "hono/jsx";
import { css } from "./css.ts";
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

/** [upper bound in seconds, unit size in seconds, unit label], tried in order. */
const STEPS: [number, number, string][] = [
  [HOUR, MINUTE, "min"],
  [DAY, HOUR, "h"],
  [7 * DAY, DAY, "d"],
];

/** Compact relative time ("3 min ago"); falls back to an ISO date after a week. */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) {
    return "unknown";
  }
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 45) {
    return "just now";
  }
  const step = STEPS.find(([limit]) => seconds < limit);
  if (!step) {
    return then.toISOString().slice(0, 10);
  }
  return `${Math.max(1, Math.round(seconds / step[1]))} ${step[2]} ago`;
}

const relativeTime = css`
  /* relative-time */
  position: relative;
  white-space: nowrap;
  border-radius: var(--radius);
  &:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  /* The title is a mouse tooltip only: a focused label shows the exact time too. */
  &:focus-visible::after {
    content: attr(title);
    position: absolute;
    inset-block-start: 100%;
    inset-inline-start: 0;
    z-index: 2;
    margin-top: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-card);
    box-shadow: var(--shadow);
    color: var(--text-primary);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
`;

/**
 * `<time>` showing a relative label, with the exact timestamp on hover and on keyboard focus (a
 * valid time takes one tab stop, since a `title` alone never reaches a keyboard user).
 */
export const RelativeTime: FC<{ value: string | Date }> = ({ value }) => {
  const date = new Date(value);
  const valid = !Number.isNaN(date.getTime());
  return (
    <time
      class={relativeTime}
      datetime={valid ? date.toISOString() : undefined}
      title={valid ? date.toUTCString() : ""}
      tabindex={valid ? 0 : undefined}
    >
      {formatRelative(value)}
    </time>
  );
};

/** The one locale and zone every absolute time renders in, whatever the host's `TZ` and `LANG`. */
const LOCALE = "en";
const TIME_ZONE = "UTC";

const FORMATS = {
  datetime: { dateStyle: "medium", timeStyle: "short" },
  date: { dateStyle: "medium" },
  time: { timeStyle: "medium" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type TimeFormat = keyof typeof FORMATS;

/** Absolute time ("Jan 15, 2026, 12:00 PM UTC"), identical on every host; "unknown" if invalid. */
export function formatAbsolute(value: string | Date, format: TimeFormat = "datetime"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  const text = new Intl.DateTimeFormat(LOCALE, {
    ...FORMATS[format],
    timeZone: TIME_ZONE,
  }).format(date);
  return format === "date" ? text : `${text} ${TIME_ZONE}`;
}

const absoluteTime = css`
  /* absolute-time */
  white-space: nowrap;
`;

/** `<time datetime>` with an explicit locale and zone (UTC, `en`), never the server's. */
export const Time: FC<{ value: string | Date; format?: TimeFormat }> = ({
  value,
  format = "datetime",
}) => {
  const date = new Date(value);
  return (
    <time
      class={absoluteTime}
      datetime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}
    >
      {formatAbsolute(value, format)}
    </time>
  );
};
