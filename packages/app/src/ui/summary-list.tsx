import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Badge, EmptyState } from "./feedback.tsx";

const list = css`
  /* summary-list */
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const row = css`
  /* summary-item */
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  /* On a phone the actions always sit under the text, on every row, so a list is never ragged. */
  @media (max-width: 480px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const main = css`
  /* summary-item-main */
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
`;

const heading = css`
  /* summary-item-heading */
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: var(--weight-semibold);
`;

const details = css`
  /* summary-item-details */
  color: var(--text-secondary);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
`;

const actions = css`
  /* summary-item-actions */
  display: flex;
  gap: var(--space-2);
`;

export interface SummaryItem {
  id: string;
  /** DOM id the row answers to (a redirect lands on it, so focus stays on the row). */
  anchor?: string;
  name: string;
  /** State badge, e.g. "Connected". */
  state?: { label: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" | "quiet" };
  /** Short details under the name. */
  details?: string;
  /** Edit, Remove and other actions (`Button size="sm"` or `DialogLink`). */
  actions?: unknown;
}

/**
 * What is configured, one row per item: name, state badge, short details and its actions. The
 * `add` slot is shown with the empty state so a list is never a dead end.
 */
export const SummaryList: FC<{
  label: string;
  items: SummaryItem[];
  emptyTitle: string;
  emptyDescription?: string;
  /** The Add action (shown in the empty state). */
  add?: unknown;
}> = ({ label, items, emptyTitle, emptyDescription, add }) => {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={add} />;
  }
  return (
    <ul class={list} aria-label={label}>
      {items.map((item) => (
        <li key={item.id} id={item.anchor} tabIndex={item.anchor ? -1 : undefined} class={row}>
          <div class={main}>
            <div class={heading}>
              {item.name}
              {item.state ? (
                <Badge tone={item.state.tone ?? "neutral"}>{item.state.label}</Badge>
              ) : null}
            </div>
            {item.details ? <div class={details}>{item.details}</div> : null}
          </div>
          {item.actions ? <div class={actions}>{item.actions}</div> : null}
        </li>
      ))}
    </ul>
  );
};
