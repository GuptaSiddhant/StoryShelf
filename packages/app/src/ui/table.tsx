import type { FC } from "hono/jsx";
import { css } from "./css.ts";
const tableWrap = css`
  /* table */
  position: relative;
  overflow: auto;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  & table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: var(--text-base);
  }
  & th,
  & td {
    text-align: left;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: middle;
  }
  & th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface-subtle);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  & tbody tr {
    transition: background var(--dur-fast) var(--ease);
  }
  & tbody tr:hover {
    background: var(--accent-wash);
  }
  & tbody tr:last-child td {
    border-bottom: 0;
  }
  & td.nowrap {
    white-space: nowrap;
  }
`;

const tableDense = css`
  /* table-dense */
  ${tableWrap}
  & th,
  & td {
    padding: var(--space-2) var(--space-3);
  }
`;

/**
 * At a phone width (480px and below) every row becomes a stacked card: the header is hidden, each
 * cell takes the full width, and a cell's `data-label` shows above its value. Cells that a page
 * hides at a wider breakpoint keep that rule, because this variant never sets their `display`.
 */
const tableStacked = css`
  /* table-stacked */
  ${tableWrap}
  @media (max-width: 480px) {
    & table,
    & tbody {
      display: block;
      width: 100%;
    }
    & thead {
      display: none;
    }
    & tr {
      display: grid;
      gap: var(--space-2);
      grid-template-columns: minmax(0, 1fr);
      padding: var(--space-3) var(--space-4);
      border-bottom: 1px solid var(--border-subtle);
    }
    & td {
      padding: 0;
      border-bottom: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    & td.nowrap {
      white-space: normal;
    }
    & td[data-label]::before {
      content: attr(data-label);
      display: block;
      margin-bottom: var(--space-1);
      color: var(--text-secondary);
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
  }
`;

const tableEmptyCell = css`
  /* table-empty */
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--text-secondary);
`;

/**
 * Scrollable bordered table surface. Pass native `<table>` markup as
 * children; the header, row hover, and spacing are styled here. The surface
 * is a focusable, named `region` so a keyboard can scroll it when the table
 * overflows and a screen reader says which table it is. `label` is required;
 * give each table on a page its own name (two regions with the same name fail
 * axe's `landmark-unique`).
 *
 * `stackOnPhone` turns each row into a card at a phone width, so nothing
 * scrolls sideways and the row's actions stay on screen. Label the cells that
 * have a column heading with `data-label`. It does not combine with `dense`.
 */
export const Table: FC<{
  dense?: boolean;
  stackOnPhone?: boolean;
  label: string;
  /** "Nothing here" message: one full-width row, no header, and `children` are not rendered. */
  empty?: unknown;
  children?: unknown;
}> = ({ dense = false, stackOnPhone = false, label, empty, children }) => {
  const surface = stackOnPhone ? tableStacked : dense ? tableDense : tableWrap;
  return (
    <div class={surface} role="region" aria-label={label} tabindex={0}>
      {empty === undefined ? (
        children
      ) : (
        <table>
          <tbody>
            <tr>
              <td class={tableEmptyCell}>{empty}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
};
