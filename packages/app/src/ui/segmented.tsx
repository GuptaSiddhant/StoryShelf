import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const segmentedRoot = css`
  /* segmented */
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  max-width: 100%;
  overflow-x: auto;
`;

const segmentedItem = css`
  /* segmented-item */
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 28px;
  padding: 0.2rem 0.7rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  text-decoration: none;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
  &:hover {
    color: var(--text-primary);
    text-decoration: none;
  }
  &[aria-pressed="true"],
  &[aria-current="page"] {
    background: var(--surface-card);
    color: var(--text-primary);
    box-shadow: var(--shadow);
  }
`;

/** One option in a `Segmented` control. */
export interface SegmentedItem {
  label: string;
  value: string;
  /** Renders a link (navigation) instead of a toggle button. */
  href?: string;
  active?: boolean;
}

/**
 * Compact single-choice control. Items with `href` navigate (filters, tabs);
 * items without toggle in place and carry `data-view-value` for client code.
 */
export const Segmented: FC<{
  items: SegmentedItem[];
  label: string;
  [key: string]: unknown;
}> = ({ items, label, ...rest }) => {
  return (
    <div class={segmentedRoot} role="group" aria-label={label} {...rest}>
      {items.map((item) =>
        item.href ? (
          <a
            key={item.value}
            class={segmentedItem}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
          >
            {item.label}
          </a>
        ) : (
          <button
            key={item.value}
            class={segmentedItem}
            type="button"
            data-view-value={item.value}
            aria-pressed={item.active ? "true" : "false"}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
};
