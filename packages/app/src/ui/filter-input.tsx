import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const filterWrap = css`
  /* filter-input */
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: min(100%, 260px);
  & svg {
    position: absolute;
    left: 0.65rem;
    color: var(--text-muted);
    pointer-events: none;
  }
  & input {
    width: 100%;
    min-height: 36px;
    padding: 0.35rem 0.7rem 0.35rem 2rem;
    background: var(--surface-card);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font: inherit;
    font-size: var(--text-base);
  }
  & input::placeholder {
    color: var(--text-muted);
  }
`;

/**
 * Client-side filter box. Matches its text against `data-filter-text` on
 * elements marked `data-filter-item` inside the nearest `[data-filter-scope]`
 * (or the whole page). Pair with a `data-filter-empty` element to show a
 * "no matches" message.
 */
export const FilterInput: FC<{ label: string; placeholder?: string }> = ({
  label,
  placeholder = "Filter…",
}) => {
  return (
    <label class={filterWrap}>
      <Icon name="search" size="sm" />
      <input type="search" data-filter-input aria-label={label} placeholder={placeholder} />
    </label>
  );
};
