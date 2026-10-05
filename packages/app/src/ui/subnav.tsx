import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";
import type { IconName } from "./icons/paths.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const layout = css`
  /* subnav-layout */
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: var(--space-6);
  align-items: start;
  @media (max-width: 880px) {
    & {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-4);
    }
  }
`;

const nav = css`
  /* subnav */
  position: sticky;
  top: calc(var(--topbar-height) + var(--space-4));
  display: flex;
  flex-direction: column;
  gap: 2px;
  @media (max-width: 880px) {
    & {
      position: static;
      flex-direction: row;
      gap: var(--space-1);
      padding-bottom: var(--space-2);
      overflow-x: auto;
      border-bottom: 1px solid var(--border);
    }
  }
`;

const link = css`
  /* subnav-link */
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 36px;
  padding: 0.4rem var(--space-3);
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
  &:hover {
    background: var(--surface-muted);
    color: var(--text-primary);
    text-decoration: none;
  }
`;

const linkActive = css`
  /* subnav-link-active */
  ${link}
  background: var(--accent-subtle);
  color: var(--accent-fg);
  font-weight: 600;
  &:hover {
    background: var(--accent-subtle);
    color: var(--accent-fg);
  }
`;

/** One entry in a `SubNavLayout`. */
export interface SubNavItem {
  label: string;
  href: string;
  icon?: IconName;
  active?: boolean;
}

/** Vertical section navigation beside content (a horizontal strip on phones). */
export const SubNavLayout: FC<{ items: SubNavItem[]; label: string; children?: unknown }> = ({
  items,
  label,
  children,
}) => {
  return (
    <div class={layout}>
      <nav class={nav} aria-label={label}>
        {items.map((item) => (
          <a
            key={item.href}
            class={item.active ? linkActive : link}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
          >
            {item.icon ? <Icon name={item.icon} /> : null}
            {item.label}
          </a>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  );
};
