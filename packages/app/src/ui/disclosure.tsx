import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";

const disclosureRoot = css`
  /* disclosure */
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
`;

const disclosureSummary = css`
  /* disclosure-summary */
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-md);
  padding: var(--space-2) var(--space-4);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  cursor: pointer;
  list-style: none;
  &::-webkit-details-marker {
    display: none;
  }
  &:hover {
    background: var(--surface-subtle);
  }
`;

const disclosureRootInline = css`
  /* disclosure-inline */
  background: none;
`;

const disclosureSummaryInline = css`
  /* disclosure-summary-inline */
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-height: var(--control-sm);
  color: var(--text-primary);
  cursor: pointer;
  list-style: none;
  &::-webkit-details-marker {
    display: none;
  }
  &:hover {
    color: var(--accent-fg);
  }
`;

const disclosureBodyInline = css`
  /* disclosure-body-inline */
  padding: var(--space-2) 0 0;
`;

const disclosureBody = css`
  /* disclosure-body */
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-top: 1px solid var(--border-subtle);
`;

const disclosureHint = css`
  /* disclosure-hint */
  font-weight: var(--weight-normal);
  font-size: var(--text-sm);
  color: var(--text-secondary);
`;

/**
 * Collapsible panel on native `<details>`; collapsed unless `open`. `variant="inline"` has no
 * border or card: the same chevron row at `--control-sm`, for a fold inside a card or a list.
 */
export const Disclosure: FC<{
  /** The row's label; the inline variant also takes a badge or other inline content. */
  title: unknown;
  variant?: "panel" | "inline";
  /** Short text after the title, e.g. a count. */
  hint?: string;
  open?: boolean;
  children?: unknown;
}> = ({ title, hint, open = false, variant = "panel", children }) => {
  if (variant === "inline") {
    return (
      <details class={disclosureRootInline} open={open}>
        <summary class={disclosureSummaryInline}>
          <Icon name="chevron-down" size="sm" />
          {title}
          {hint ? <span class={disclosureHint}>{hint}</span> : null}
        </summary>
        <div class={disclosureBodyInline}>{children}</div>
      </details>
    );
  }
  return (
    <details class={disclosureRoot} open={open}>
      <summary class={disclosureSummary}>
        <Icon name="chevron-down" size="sm" />
        {title}
        {hint ? <span class={disclosureHint}>{hint}</span> : null}
      </summary>
      <div class={disclosureBody}>{children}</div>
    </details>
  );
};

const definitionList = css`
  /* definition-list */
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-6);
  margin: var(--space-3) 0;
`;

const definitionTerm = css`
  /* definition-term */
  color: var(--text-secondary);
`;

const definitionDesc = css`
  /* definition-desc */
  margin: 0;
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
`;

/** Compact label/value pairs; replaces a wall of stat cards. */
export const DefinitionList: FC<{
  items: readonly { label: string; value: string | number; note?: string }[];
}> = ({ items }) => {
  return (
    <dl class={definitionList}>
      {items.map((item) => (
        <>
          <dt class={definitionTerm}>{item.label}</dt>
          <dd class={definitionDesc}>
            {String(item.value)}
            {item.note ? <span class={disclosureHint}> {item.note}</span> : null}
          </dd>
        </>
      ))}
    </dl>
  );
};
