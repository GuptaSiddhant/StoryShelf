// Explicit JSX runtime edge so JSR unfurls it to an absolute specifier in
// published tarballs. The synthesized import would otherwise stay bare and
// unresolvable server-side (see honojs/hono#3219).
import "hono/jsx/jsx-runtime";
import type { FC } from "hono/jsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

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

// eslint-disable-next-line promise-function-async -- JSX component return type
export const Badge: FC<{ tone?: BadgeTone; children?: unknown }> = ({ tone = "neutral", children }) => {
  return <span class={`badge badge--${tone}`}>{children}</span>;
};

export function statusTone(status: string): BadgeTone {
  if (status === "approved" || status === "unchanged") {
    return "success";
  }
  if (status === "rejected" || status === "failed") {
    return "danger";
  }
  if (status === "changed" || status === "new" || status === "reviewing") {
    return "warning";
  }
  if (status === "capturing" || status === "comparing" || status === "pending") {
    return "info";
  }
  return "neutral";
}

// eslint-disable-next-line promise-function-async -- JSX component return type
export const Card: FC<{ children?: unknown; padded?: boolean }> = ({ children, padded = true }) => {
  return <div class={padded ? "card card--padded" : "card"}>{children}</div>;
};

// eslint-disable-next-line promise-function-async -- JSX component return type
export const Alert: FC<{ tone?: BadgeTone; title?: string; children?: unknown }> = ({ tone = "info", title, children }) => {
  return (
    <div class={`alert alert--${tone}`} role="alert">
      {title ? <strong class="alert__title">{title}</strong> : null}
      <div class="alert__body">{children}</div>
    </div>
  );
};

// eslint-disable-next-line promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString>
const FieldAssistant: FC<{ name: string; error: string | undefined; hint: string | undefined }> = ({ name, error, hint }) => {
  if (error) {
    return (
      <p class="field__error" id={`${name}-error`} role="alert">
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p class="field__hint" id={`${name}-hint`}>
        {hint}
      </p>
    );
  }
  return null;
};

function fieldDescribedBy(name: string, error: string | undefined, hint: string | undefined): string | undefined {
  if (error) {
    return `${name}-error`;
  }
  if (hint) {
    return `${name}-hint`;
  }
  return undefined;
}

// eslint-disable-next-line promise-function-async -- JSX component return type
export const Field: FC<{
  label: string;
  name: string;
  type?: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  autocomplete?: string;
}> = ({ label, name, type = "text", value, placeholder, required, error, hint, autocomplete }) => {
  return (
    <div class="field">
      <label class="field__label" for={name}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        class={`field__input ${error ? "field__input--error" : ""}`}
        id={name}
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={fieldDescribedBy(name, error, hint)}
        autocomplete={autocomplete}
      />
      <FieldAssistant name={name} error={error} hint={hint} />
    </div>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
export const TextareaField: FC<{
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
  rows?: number;
  hint?: string;
  error?: string;
}> = ({ label, name, value, placeholder, rows = 3, hint, error }) => {
  return (
    <div class="field">
      <label class="field__label" for={name}>
        {label}
      </label>
      <textarea
        class={`field__input field__input--textarea ${error ? "field__input--error" : ""}`}
        id={name}
        name={name}
        placeholder={placeholder}
        rows={rows}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={fieldDescribedBy(name, error, hint)}
      >
        {value}
      </textarea>
      <FieldAssistant name={name} error={error} hint={hint} />
    </div>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
export const SelectField: FC<{
  label: string;
  name: string;
  value?: string;
  options: { value: string; label: string }[];
  hint?: string;
}> = ({ label, name, value, options, hint }) => {
  return (
    <div class="field">
      <label class="field__label" for={name}>
        {label}
      </label>
      <select class="field__input" id={name} name={name} aria-describedby={hint ? `${name}-hint` : undefined}>
        {options.map((opt) => (
          <option value={opt.value} selected={opt.value === value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p class="field__hint" id={`${name}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
export const PageHeader: FC<{
  title: string;
  description?: string;
  actions?: unknown;
  breadcrumbs?: { label: string; href?: string }[];
}> = ({ title, description, actions, breadcrumbs }) => {
  return (
    <div class="page-header">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((crumb, index) => (
              <li key={String(index)}>
                {crumb.href ? <a href={crumb.href}>{crumb.label}</a> : <span aria-current="page">{crumb.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div class="page-header__row">
        <div>
          <h1 class="page-header__title">{title}</h1>
          {description ? <p class="page-header__desc">{description}</p> : null}
        </div>
        {actions ? <div class="page-header__actions">{actions}</div> : null}
      </div>
    </div>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
export const EmptyState: FC<{ title: string; description?: string; action?: unknown }> = ({ title, description, action }) => {
  return (
    <div class="empty">
      <h2 class="empty__title">{title}</h2>
      {description ? <p class="empty__desc">{description}</p> : null}
      {action ? <div class="empty__action">{action}</div> : null}
    </div>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
export const Tabs: FC<{
  tabs: { label: string; href: string; active?: boolean }[];
}> = ({ tabs }) => {
  return (
    <nav class="tabs" aria-label="Sections">
      {tabs.map((tab) => (
        <a class={`tabs__link ${tab.active ? "tabs__link--active" : ""}`} href={tab.href} aria-current={tab.active ? "page" : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
export const Stat: FC<{ label: string; value: string | number }> = ({ label, value }) => {
  return (
    <div class="stat">
      <div class="stat__value">{String(value)}</div>
      <div class="stat__label">{label}</div>
    </div>
  );
};
