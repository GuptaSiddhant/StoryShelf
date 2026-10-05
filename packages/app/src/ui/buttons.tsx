import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "md" | "sm";

const btnBase = css`
  /* btn */
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 0.55rem 0.9rem;
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  line-height: 1.2;
  min-height: 40px;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    filter 120ms ease;
  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const btnPrimary = css`
  /* btn-primary */
  ${btnBase}
  background: var(--accent);
  color: var(--accent-contrast);
  border-color: var(--accent);
  &:hover {
    filter: brightness(1.06);
    text-decoration: none;
  }
`;

const btnPrimarySm = css`
  /* btn-primary-sm */
  ${btnPrimary}
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
  min-height: 32px;
`;

const btnSecondary = css`
  /* btn-secondary */
  ${btnBase}
  background: var(--surface-card);
  color: var(--text-primary);
  border-color: var(--border);
  box-shadow: var(--shadow);
  &:hover {
    background: var(--surface-subtle);
    text-decoration: none;
  }
`;

const btnSecondarySm = css`
  /* btn-secondary-sm */
  ${btnSecondary}
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
  min-height: 32px;
`;

const btnOutline = css`
  /* btn-outline */
  ${btnSecondary}
  &:hover {
    background: var(--surface-subtle);
    text-decoration: none;
  }
`;

const btnOutlineSm = css`
  /* btn-outline-sm */
  ${btnOutline}
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
  min-height: 32px;
`;

const btnGhost = css`
  /* btn-ghost */
  ${btnBase}
  background: transparent;
  color: var(--text-secondary);
  border-color: transparent;
  &:hover {
    background: var(--surface-muted);
    color: var(--text-primary);
    text-decoration: none;
  }
`;

const btnGhostSm = css`
  /* btn-ghost-sm */
  ${btnGhost}
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
  min-height: 32px;
`;

const btnDanger = css`
  /* btn-danger */
  ${btnBase}
  background: var(--status-rejected);
  color: #fff;
  border-color: var(--status-rejected);
  &:hover {
    filter: brightness(1.06);
    text-decoration: none;
  }
`;

const btnDangerSm = css`
  /* btn-danger-sm */
  ${btnDanger}
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
  min-height: 32px;
`;

const btnClasses: Record<ButtonVariant, Record<ButtonSize, Promise<string>>> = {
  primary: { md: btnPrimary, sm: btnPrimarySm },
  secondary: { md: btnSecondary, sm: btnSecondarySm },
  outline: { md: btnOutline, sm: btnOutlineSm },
  ghost: { md: btnGhost, sm: btnGhostSm },
  danger: { md: btnDanger, sm: btnDangerSm },
};

const tabsNav = css`
  /* tabs */
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1rem;
  overflow-x: auto;
`;

const tabsLink = css`
  /* tabs-link */
  padding: 0.55rem 0.75rem;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 0.875rem;
  text-decoration: none;
  white-space: nowrap;
  font-weight: 600;
  &:hover {
    color: var(--text-primary);
    text-decoration: none;
  }
`;

const tabsLinkActive = css`
  /* tabs-link-active */
  ${tabsLink}
  color: var(--text-primary);
  border-bottom-color: var(--accent);
`;

/** Button or link styled as a button (renders an anchor when `href` is set). */
export const Button: FC<{
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit" | "reset";
  href?: string;
  disabled?: boolean;
  children?: unknown;
  [key: string]: unknown;
}> = ({ variant = "primary", size = "md", type = "button", href, disabled, children, ...rest }) => {
  const cls = btnClasses[variant][size];
  if (href) {
    return (
      <a class={cls} href={href} aria-disabled={disabled ? "true" : undefined} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button class={cls} type={type} disabled={disabled} {...rest}>
      {children}
    </button>
  );
};

/** Tab navigation bar for section switching. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Tabs: FC<{
  tabs: { label: string; href: string; active?: boolean }[];
  label?: string;
}> = ({ tabs, label = "Sections" }) => {
  return (
    <nav class={tabsNav} aria-label={label}>
      {tabs.map((tab) => (
        <a
          class={tab.active ? tabsLinkActive : tabsLink}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
};
