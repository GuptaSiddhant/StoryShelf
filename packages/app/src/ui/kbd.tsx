import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const kbdKey = css`
  /* kbd */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.4rem;
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.3;
`;

/** Keyboard key chip: one key, or a sequence given as an array. */
export const Kbd: FC<{ keys: string | string[] }> = ({ keys }) => {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <>
      {list.map((key, index) => (
        <kbd key={String(index)} class={kbdKey}>
          {key}
        </kbd>
      ))}
    </>
  );
};
