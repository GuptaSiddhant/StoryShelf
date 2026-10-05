import type { FC } from "hono/jsx";
import { css } from "./css.ts";
import { Icon } from "./icons/icon.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type FieldLayout = "stack" | "inline";

const fieldWrap = css`
  /* field */
  display: grid;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
`;

const fieldWrapInline = css`
  /* field-inline */
  ${fieldWrap}
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 0;
`;

const fieldLabel = css`
  /* field-label */
  color: var(--text-primary);
  font-weight: 600;
  font-size: var(--text-sm);
  & span[aria-hidden] {
    color: var(--status-rejected);
  }
`;

const fieldInput = css`
  /* field-input */
  width: 100%;
  min-height: 40px;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-card);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-base);
  box-shadow: var(--shadow);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
  &::placeholder {
    color: var(--text-muted);
  }
  &:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--text-secondary) 45%, var(--border));
  }
  &:focus {
    outline: none;
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 25%, transparent);
  }
  &:disabled {
    background: var(--surface-muted);
    color: var(--text-secondary);
    cursor: not-allowed;
  }
`;

const fieldInputError = css`
  /* field-input-error */
  ${fieldInput}
  border-color: var(--status-rejected);
  &:focus {
    border-color: var(--status-rejected);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-rejected) 25%, transparent);
  }
`;

const fieldTextarea = css`
  /* field-textarea */
  ${fieldInput}
  resize: vertical;
  min-height: 5.5rem;
  line-height: var(--leading-normal);
`;

const fieldTextareaError = css`
  /* field-textarea-error */
  ${fieldInputError}
  resize: vertical;
  min-height: 5.5rem;
  line-height: var(--leading-normal);
`;

const fieldHint = css`
  /* field-hint */
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
`;

const fieldError = css`
  /* field-error */
  display: flex;
  gap: var(--space-1);
  align-items: flex-start;
  margin: 0;
  color: var(--status-rejected-fg);
  font-size: var(--text-sm);
  font-weight: 600;
`;

const formActions = css`
  /* form-actions */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin-top: var(--space-4);
`;

const formActionsEnd = css`
  /* form-actions-end */
  ${formActions}
  justify-content: flex-end;
`;

const formActionsSplit = css`
  /* form-actions-split */
  ${formActions}
  justify-content: space-between;
`;

/** Row of form buttons: primary action first; `align="end"` right-aligns, `"split"` spreads. */
export const FormActions: FC<{ align?: "start" | "end" | "split"; children?: unknown }> = ({
  align = "start",
  children,
}) => {
  const cls = align === "end" ? formActionsEnd : align === "split" ? formActionsSplit : formActions;
  return <div class={cls}>{children}</div>;
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

// eslint-disable-next-line promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString>
const FieldAssistant: FC<{ name: string; error: string | undefined; hint: string | undefined }> = ({
  name,
  error,
  hint,
}) => {
  if (error) {
    return (
      <p class={fieldError} id={`${name}-error`} role="alert">
        <Icon name="x-circle" size="sm" />
        <span>{error}</span>
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
  gap: var(--space-2);
  align-items: center;
  font-weight: 500;
  font-size: var(--text-base);
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
