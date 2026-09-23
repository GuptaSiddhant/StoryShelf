import type { FC } from "hono/jsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

// eslint-disable-next-line promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString>
const FieldAssistant: FC<{ name: string; error: string | undefined; hint: string | undefined }> = ({
  name,
  error,
  hint,
}) => {
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

function fieldDescribedBy(
  name: string,
  error: string | undefined,
  hint: string | undefined,
): string | undefined {
  if (error) {
    return `${name}-error`;
  }
  if (hint) {
    return `${name}-hint`;
  }
  return undefined;
}

/** Labeled text input with error and hint states. */
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

/** Labeled textarea with error and hint states. */
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

/** Labeled select dropdown with an optional hint. */
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
      <select
        class="field__input"
        id={name}
        name={name}
        aria-describedby={hint ? `${name}-hint` : undefined}
      >
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

/** Form field styles owned by this module. */
export function formsCss(): string {
  return `
    .field { display: grid; gap: .35rem; margin-bottom: .875rem; }
    .field__label { font-weight: 600; font-size: .85rem; }
    .field__input { width: 100%; padding: .55rem .65rem; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-card); color: var(--text-primary); font: inherit; font-size: .875rem; box-shadow: var(--shadow); }
    .field__input::placeholder { color: var(--text-muted); }
    .field__input:focus { outline: 2px solid var(--ring); outline-offset: 0; border-color: var(--ring); }
    .field__input--error { border-color: var(--status-rejected); }
    .field__input--error:focus { outline-color: var(--status-rejected); border-color: var(--status-rejected); }
    .field__input--textarea { resize: vertical; min-height: 5rem; }
    select.field__input { appearance: auto; }
    .field__hint { margin: 0; color: var(--text-secondary); font-size: .82rem; }
    .field__error { margin: 0; color: var(--status-rejected); font-size: .82rem; font-weight: 600; }`;
}
