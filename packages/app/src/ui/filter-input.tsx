import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";
const filterWrap = css`
  /* filter-input */
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: min(100%, 260px);
  & svg {
    position: absolute;
    left: var(--space-3);
    color: var(--text-muted);
    pointer-events: none;
  }
  & input {
    width: 100%;
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-3) var(--space-1) var(--space-8);
    background: var(--surface-card);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font: inherit;
    font-size: var(--text-base);
  }
  & input:focus-visible {
    border-color: var(--ring);
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
