import type { FC } from "hono/jsx";
import { css } from "./css.ts";

const optionList = css`
  /* option-list */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
`;

const option = css`
  /* option */
  appearance: none;
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  max-width: 100%;
  min-height: var(--control-sm);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  text-align: left;
  cursor: pointer;
  &:hover {
    background: var(--surface-muted);
    border-color: var(--accent-border);
  }
  &:active {
    background: var(--accent-subtle);
  }
  &[aria-current="true"],
  &:focus-visible {
    background: var(--accent-subtle);
    border-color: var(--accent-border);
    color: var(--accent-fg);
  }
  &:disabled {
    opacity: 1;
    background: var(--surface-muted);
    color: var(--text-secondary);
    cursor: not-allowed;
  }
`;

/**
 * A group of choices that reads as choices: each option has a border at rest, a hover and press
 * background, and one highlighted state shared by the selected option (`aria-current`) and the
 * keyboard-focused one, so the two never disagree.
 */
export const OptionList: FC<{ label: string; children?: unknown }> = ({ label, children }) => {
  return (
    <div class={optionList} role="group" aria-label={label}>
      {children}
    </div>
  );
};

/** One choice: a button, so HTMX attributes (`hx-post`, `hx-vals`, …) pass straight through. */
export const Option: FC<{
  /** The highlighted choice, the same state a keyboard focus shows. */
  selected?: boolean;
  disabled?: boolean;
  children?: unknown;
  [key: string]: unknown;
}> = ({ selected = false, disabled = false, children, ...rest }) => {
  return (
    <button
      class={option}
      type="button"
      aria-current={selected ? "true" : undefined}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
};
