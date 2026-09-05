import type { FC } from "hono/jsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** Button or link styled as a button (renders an anchor when `href` is set). */
export const Button: FC<{
  variant?: ButtonVariant;
  type?: "button" | "submit" | "reset";
  href?: string;
  disabled?: boolean;
  children?: unknown;
  [key: string]: unknown;
}> = ({ variant = "primary", type = "button", href, disabled, children, ...rest }) => {
  const className = `btn btn--${variant}`;
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
