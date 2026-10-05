import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const tableWrap = css`
  /* table */
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
    padding: 0.7rem 0.9rem;
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
    font-weight: 600;
    letter-spacing: 0.04em;
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
    padding: 0.4rem 0.75rem;
  }
`;

/**
 * Scrollable bordered table surface. Pass native `<table>` markup as
 * children; the header, row hover, and spacing are styled here.
 */
export const Table: FC<{ dense?: boolean; children?: unknown }> = ({ dense = false, children }) => {
  return <div class={dense ? tableDense : tableWrap}>{children}</div>;
};
