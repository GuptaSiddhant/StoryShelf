import type { FC } from "hono/jsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "md" | "sm";

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
  const className = `btn btn--${variant}${size === "sm" ? " btn--sm" : ""}`;
  if (href) {
    return (
      <a class={className} href={href} aria-disabled={disabled ? "true" : undefined} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button class={className} type={type} disabled={disabled} {...rest}>
      {children}
    </button>
  );
};

/** Tab navigation bar for section switching. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Tabs: FC<{
  tabs: { label: string; href: string; active?: boolean }[];
}> = ({ tabs }) => {
  return (
    <nav class="tabs" aria-label="Sections">
      {tabs.map((tab) => (
        <a
          class={`tabs__link ${tab.active ? "tabs__link--active" : ""}`}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
};

/** Button, tab, and segmented-control styles owned by this module. */
export function buttonsCss(): string {
  return `
    .btn { appearance: none; border: 1px solid transparent; border-radius: var(--radius-sm); padding: .55rem .9rem; font-weight: 600; font-size: .875rem; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: .4rem; line-height: 1.2; min-height: 40px; transition: background 120ms ease, border-color 120ms ease, filter 120ms ease; }
    .btn--sm { padding: .35rem .6rem; font-size: .8rem; min-height: 32px; }
    .btn--primary { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
    .btn--primary:hover { filter: brightness(1.06); text-decoration: none; }
    .btn--secondary, .btn--outline { background: var(--surface-card); color: var(--text-primary); border-color: var(--border); box-shadow: var(--shadow); }
    .btn--secondary:hover, .btn--outline:hover { background: var(--surface-subtle); text-decoration: none; }
    .btn--ghost { background: transparent; color: var(--text-secondary); border-color: transparent; }
    .btn--ghost:hover { background: var(--surface-muted); color: var(--text-primary); text-decoration: none; }
    .btn--danger { background: var(--status-rejected); color: #fff; border-color: var(--status-rejected); }
    .btn--danger:hover { filter: brightness(1.06); text-decoration: none; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .tabs { display: flex; gap: .25rem; border-bottom: 1px solid var(--border); margin-bottom: 1rem; overflow-x: auto; }
    .tabs__link { padding: .55rem .75rem; border-bottom: 2px solid transparent; color: var(--text-secondary); font-size: .875rem; text-decoration: none; white-space: nowrap; font-weight: 600; }
    .tabs__link:hover { color: var(--text-primary); text-decoration: none; }
    .tabs__link--active { color: var(--text-primary); border-bottom-color: var(--accent); }`;
}
