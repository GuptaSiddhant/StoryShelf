import { safeImageUrl } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import { css } from "../css.ts";
import { Icon } from "../icons/icon.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Chrome-free page for signed-out flows: brand over a centered column. */
const bareRoot = css`
  /* bare */
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--space-5);
  min-height: 100vh;
  padding: var(--space-6) var(--space-4);
  background: radial-gradient(60rem 30rem at 50% -10%, var(--accent-subtle), transparent 70%);
  .bare__brand {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text-primary);
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .bare__mark {
    display: inline-grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .bare__body {
    width: min(400px, 100%);
  }
`;

/** Brand header plus a narrow column, used instead of the app shell. */
export const BareShell: FC<{ name: string; logo?: string; children?: unknown }> = ({
  name,
  logo,
  children,
}) => {
  const safeLogo = safeImageUrl(logo);
  return (
    <div class={bareRoot}>
      <div class="bare__brand">
        {safeLogo ? (
          <img src={safeLogo} alt="" width="34" height="34" />
        ) : (
          <span class="bare__mark" aria-hidden="true">
            <Icon name="layers" />
          </span>
        )}
        <span>{name}</span>
      </div>
      <main id="main-content" class="bare__body" tabindex={-1}>
        {children}
      </main>
    </div>
  );
};
