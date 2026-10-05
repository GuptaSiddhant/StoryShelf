import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";
import type { IconName } from "./icons/paths.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const dropdownRoot = css`
  /* dropdown */
  position: relative;
  display: inline-block;
`;

const dropdownRootBlock = css`
  /* dropdown-block */
  ${dropdownRoot}
  display: block;
  width: 100%;
`;

const dropdownTrigger = css`
  /* dropdown-trigger */
  list-style: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 36px;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-card);
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: 600;
  cursor: pointer;
  &::-webkit-details-marker {
    display: none;
  }
  &:hover {
    background: var(--surface-subtle);
  }
`;

const dropdownTriggerGhost = css`
  /* dropdown-trigger-ghost */
  ${dropdownTrigger}
  min-height: 34px;
  width: 100%;
  justify-content: space-between;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  &:hover {
    background: var(--surface-muted);
  }
`;

const dropdownMenu = css`
  /* dropdown-menu */
  position: absolute;
  z-index: 50;
  top: calc(100% + 4px);
  left: 0;
  min-width: 12rem;
  padding: 0.25rem;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-2);
`;

const dropdownMenuEnd = css`
  /* dropdown-menu-end */
  ${dropdownMenu}
  left: auto;
  right: 0;
`;

const dropdownMenuAbove = css`
  /* dropdown-menu-above */
  ${dropdownMenu}
  top: auto;
  bottom: calc(100% + 4px);
`;

const dropdownMenuAboveEnd = css`
  /* dropdown-menu-above-end */
  ${dropdownMenuEnd}
  top: auto;
  bottom: calc(100% + 4px);
`;

const menuClasses = {
  below: { start: dropdownMenu, end: dropdownMenuEnd },
  above: { start: dropdownMenuAbove, end: dropdownMenuAboveEnd },
};

const dropdownItem = css`
  /* dropdown-item */
  appearance: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-base);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  &:hover {
    background: var(--surface-muted);
    text-decoration: none;
  }
  &[aria-current="true"] {
    background: var(--accent-subtle);
    color: var(--accent-fg);
  }
`;

const dropdownDivider = css`
  /* dropdown-divider */
  height: 1px;
  margin: 0.25rem 0;
  background: var(--border-subtle);
`;

/** Popover menu built on native `<details>`; `align="end"` opens leftward. */
export const Dropdown: FC<{
  label: unknown;
  align?: "start" | "end";
  /** Accessible name when the label is only an icon or avatar. */
  ariaLabel?: string;
  /** Hide the trailing chevron (icon-only triggers). */
  iconOnly?: boolean;
  /** Open upward (menus anchored at the bottom of the screen). */
  placement?: "below" | "above";
  /** Full-width, borderless trigger (sidebar rows). */
  block?: boolean;
  children?: unknown;
}> = ({
  label,
  align = "start",
  ariaLabel,
  iconOnly = false,
  placement = "below",
  block = false,
  children,
}) => {
  return (
    <details class={block ? dropdownRootBlock : dropdownRoot} data-dropdown>
      <summary class={block ? dropdownTriggerGhost : dropdownTrigger} aria-label={ariaLabel}>
        {label}
        {iconOnly ? null : (
          <Icon name={placement === "above" ? "chevron-up" : "chevron-down"} size="sm" />
        )}
      </summary>
      <div class={menuClasses[placement][align]} role="menu">
        {children}
      </div>
    </details>
  );
};

/** Menu entry: a link when `href` is set, otherwise a button (forms, actions). */
export const DropdownItem: FC<{
  href?: string;
  icon?: IconName;
  current?: boolean;
  children?: unknown;
  [key: string]: unknown;
}> = ({ href, icon, current = false, children, ...rest }) => {
  const content = (
    <>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </>
  );
  const aria = current ? "true" : undefined;
  if (href) {
    return (
      <a class={dropdownItem} role="menuitem" href={href} aria-current={aria} {...rest}>
        {content}
      </a>
    );
  }
  return (
    <button class={dropdownItem} role="menuitem" type="button" aria-current={aria} {...rest}>
      {content}
    </button>
  );
};

/** Hairline between menu groups. */
export const DropdownDivider: FC = () => {
  return <div class={dropdownDivider} role="separator" />;
};
