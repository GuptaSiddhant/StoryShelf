import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const track = css`
  /* progress */
  height: 6px;
  overflow: hidden;
  background: var(--surface-muted);
  border-radius: var(--radius-pill);
  & > span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
    transition: width var(--dur-base) var(--ease);
  }
`;

const trackDone = css`
  /* progress-done */
  ${track}
  & > span {
    background: var(--status-approved);
  }
`;

/** Determinate progress bar; turns green when `value` reaches `max`. */
export const Progress: FC<{ value: number; max: number; label: string }> = ({
  value,
  max,
  label,
}) => {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      class={max > 0 && value >= max ? trackDone : track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
    >
      <span style={`width:${percent}%`} />
    </div>
  );
};
