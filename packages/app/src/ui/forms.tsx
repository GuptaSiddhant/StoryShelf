import type { FC } from "hono/jsx";
import { css } from "./css.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type FieldLayout = "stack" | "inline";

const fieldWrap = css`
  /* field */
  display: grid;
  gap: 0.35rem;
  margin-bottom: 0.875rem;
`;

const fieldWrapInline = css`
  /* field-inline */
  ${fieldWrap}
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0;
`;

const fieldLabel = css`
  /* field-label */
  font-weight: 600;
  font-size: 0.85rem;
`;

const fieldInput = css`
  /* field-input */
  width: 100%;
  padding: 0.55rem 0.65rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-card);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.875rem;
  box-shadow: var(--shadow);
  &::placeholder {
    color: var(--text-muted);
  }
  &:focus {
    outline: 2px solid var(--ring);
    outline-offset: 0;
    border-color: var(--ring);
  }
`;

const fieldInputError = css`
  /* field-input-error */
  ${fieldInput}
  border-color: var(--status-rejected);
  &:focus {
    outline-color: var(--status-rejected);
    border-color: var(--status-rejected);
  }
`;

const fieldTextarea = css`
  /* field-textarea */
  ${fieldInput}
  resize: vertical;
  min-height: 5rem;
`;

const fieldTextareaError = css`
  /* field-textarea-error */
  ${fieldInputError}
  resize: vertical;
  min-height: 5rem;
`;

const fieldHint = css`
  /* field-hint */
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
`;

const fieldError = css`
  /* field-error */
  margin: 0;
  color: var(--status-rejected);
  font-size: 0.82rem;
  font-weight: 600;
`;

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

// eslint-disable-next-line promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString>
const FieldAssistant: FC<{ name: string; error: string | undefined; hint: string | undefined }> = ({
  name,
  error,
  hint,
}) => {
  if (error) {
    return (
      <p class={fieldError} id={`${name}-error`} role="alert">
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p class={fieldHint} id={`${name}-hint`}>
        {hint}
      </p>
    );
  }
  return null;
};

/** Labeled text input with error and hint states. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const Field: FC<{
  label: string;
  name: string;
  type?: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  pattern?: string;
  min?: string;
  max?: string;
  step?: string;
  layout?: FieldLayout;
  error?: string;
  hint?: string;
  autocomplete?: string;
}> = ({
  label,
  name,
  type = "text",
  value,
  placeholder,
  required,
  disabled,
  autofocus,
  pattern,
  min,
  max,
  step,
  layout = "stack",
  error,
  hint,
  autocomplete,
}) => {
  return (
    <div class={layout === "inline" ? fieldWrapInline : fieldWrap}>
      <label class={fieldLabel} for={name}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        class={error ? fieldInputError : fieldInput}
        id={name}
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autofocus={autofocus}
        pattern={pattern}
        min={min}
        max={max}
        step={step}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={fieldDescribedBy(name, error, hint)}
        autocomplete={autocomplete}
      />
      <FieldAssistant name={name} error={error} hint={hint} />
    </div>
  );
};

const checkLabel = css`
  /* check-label */
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
`;

const checkInput = css`
  /* check-input */
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent);
  flex: none;
`;

/** Inline checkbox row with an optional hint. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const CheckField: FC<{
  label: unknown;
  name: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  hint?: string;
}> = ({ label, name, value, checked, disabled, hint }) => {
  return (
    <div class={fieldWrap}>
      <label class={checkLabel} for={name}>
        <input
          class={checkInput}
          type="checkbox"
          id={name}
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
        />
        {label}
      </label>
      {hint ? (
        <p class={fieldHint} id={`${name}-hint`}>
          {hint}
        </p>
      ) : null}
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
  required?: boolean;
  hint?: string;
  error?: string;
}> = ({ label, name, value, placeholder, rows = 3, required, hint, error }) => {
  return (
    <div class={fieldWrap}>
      <label class={fieldLabel} for={name}>
        {label}
      </label>
      <textarea
        class={error ? fieldTextareaError : fieldTextarea}
        id={name}
        name={name}
        placeholder={placeholder}
        rows={rows}
        required={required}
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
  disabled?: boolean;
  required?: boolean;
  layout?: FieldLayout;
}> = ({ label, name, value, options, hint, disabled, required, layout = "stack" }) => {
  return (
    <div class={layout === "inline" ? fieldWrapInline : fieldWrap}>
      <label class={fieldLabel} for={name}>
        {label}
      </label>
      <select
        class={fieldInput}
        id={name}
        name={name}
        disabled={disabled}
        required={required}
        aria-describedby={hint ? `${name}-hint` : undefined}
      >
        {options.map((opt) => (
          <option value={opt.value} selected={opt.value === value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p class={fieldHint} id={`${name}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
};
