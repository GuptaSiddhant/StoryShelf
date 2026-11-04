import type { FC } from "hono/jsx";
import { Button } from "./buttons.tsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const codeWrap = css`
  /* code-block */
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  & pre {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 0.3rem 0;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    white-space: pre;
  }
  & pre:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
`;

/**
 * Monospace command/snippet with a copy button (wired by the shell script). The snippet scrolls
 * sideways when it is wider than its box, so it takes keyboard focus (`tabindex`) and a keyboard can scroll it.
 */
export const CodeBlock: FC<{ code: string; label?: string }> = ({ code, label = "Copy" }) => {
  return (
    <div class={codeWrap}>
      <pre tabindex={0}>
        <code>{code}</code>
      </pre>
      <Button variant="ghost" size="sm" icon="copy" data-copy={code} aria-label={label}>
        {label}
      </Button>
    </div>
  );
};
