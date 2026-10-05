import type { FC } from "hono/jsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

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

/** `<time>` showing a relative label, with the exact timestamp on hover. */
export const RelativeTime: FC<{ value: string | Date }> = ({ value }) => {
  const date = new Date(value);
  const valid = !Number.isNaN(date.getTime());
  return (
    <time datetime={valid ? date.toISOString() : undefined} title={valid ? date.toUTCString() : ""}>
      {formatRelative(value)}
    </time>
  );
};
