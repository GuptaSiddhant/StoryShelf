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
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  font-weight: 600;
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

const disclosureBody = css`
  /* disclosure-body */
  padding: 0.25rem 1rem 1rem;
  border-top: 1px solid var(--border-subtle);
`;

const disclosureHint = css`
  /* disclosure-hint */
  font-weight: 400;
  font-size: var(--text-sm);
  color: var(--text-secondary);
`;

/** Collapsible panel on native `<details>`; collapsed unless `open`. */
export const Disclosure: FC<{
  title: string;
  /** Short text after the title, e.g. a count. */
  hint?: string;
  open?: boolean;
  children?: unknown;
}> = ({ title, hint, open = false, children }) => {
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
  gap: 0.35rem 1.5rem;
  margin: 0.75rem 0;
`;

const definitionTerm = css`
  /* definition-term */
  color: var(--text-secondary);
`;

const definitionDesc = css`
  /* definition-desc */
  margin: 0;
  font-weight: 600;
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
