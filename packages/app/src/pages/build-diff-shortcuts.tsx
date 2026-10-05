import type { HtmlEscapedString } from "hono/utils/html";
import { Button, Kbd } from "../ui/components.tsx";
import { shortcutsDialog } from "../ui/styles/review-layout.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["j", "→"], action: "Next snapshot" },
  { keys: ["k", "←"], action: "Previous snapshot" },
  { keys: ["a"], action: "Approve" },
  { keys: ["r"], action: "Reject" },
  { keys: ["1", "–", "5"], action: "Side by side, swipe, onion skin, diff, flip" },
  { keys: ["f"], action: "Cycle zoom (fit, 100%, 200%)" },
  { keys: ["t"], action: "Flip baseline / current" },
  { keys: ["?"], action: "Show this help" },
];

/** Native dialog listing the review keyboard shortcuts (opened with `?`). */
export function ShortcutsDialog(): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <dialog class={shortcutsDialog} data-shortcuts aria-labelledby="shortcuts-title">
      <h2 id="shortcuts-title">Keyboard shortcuts</h2>
      <dl>
        {SHORTCUTS.map((item) => (
          <>
            <dt>
              <Kbd keys={item.keys} />
            </dt>
            <dd>{item.action}</dd>
          </>
        ))}
      </dl>
      <form method="dialog">
        <Button variant="secondary" size="sm" type="submit">
          Close
        </Button>
      </form>
    </dialog>
  );
}
