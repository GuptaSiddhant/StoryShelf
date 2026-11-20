import type { FC } from "hono/jsx";
import { z } from "zod";
import { css } from "./css.ts";

/** At most this many options: the no-script CSS is written per position. */
export const MAX_OPTIONS = 6;

const positions = Array.from({ length: MAX_OPTIONS }, (_, index) => index + 1);

/**
 * Hide every group, then show the one whose radio is checked (no script). The attribute value is
 * unquoted: hono/css escapes quotes in an interpolated string, which made the selector match no
 * radio and hid every group.
 */
const groupRules = positions
  .map(
    (n) =>
      `&:has(input[type=radio]:nth-of-type(${n}):checked) fieldset[data-option-group]:nth-of-type(${n}){display:block;}`,
  )
  .join("\n  ");

const optionRoot = css`
  /* option-fields */
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
  border: 0;
  margin: 0;
  padding: 0;
  fieldset[data-option-group] {
    display: none;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  fieldset[data-option-group][disabled] {
    display: none;
  }
  ${groupRules}
`;

const optionLegend = css`
  /* option-fields-legend */
  padding: 0;
  margin-bottom: 0.5rem;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
`;

const choiceBar = css`
  /* option-fields-bar */
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  max-width: 100%;
  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
`;

const choiceLabel = css`
  /* option-fields-choice */
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 34px;
  padding: 0.2rem 0.7rem;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  cursor: pointer;
`;

const choiceBarSelected = css`
  /* option-fields-bar-selected */
  ${choiceBar}
  input:checked + label {
    background: var(--surface-card);
    color: var(--text-primary);
    box-shadow: var(--shadow);
  }
  input:focus-visible + label {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`;

const cardBar = css`
  /* option-fields-cards */
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.5rem;
  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  input:checked + label {
    border-color: var(--accent-border);
    background: var(--accent-subtle);
    color: var(--accent-fg);
  }
  input:focus-visible + label {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`;

const cardLabel = css`
  /* option-fields-card */
  ${choiceLabel}
  flex-direction: column;
  justify-content: center;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-card);
  color: var(--text-primary);
  text-align: center;
`;

const groupLegend = css`
  /* option-fields-group-legend */
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
`;

export interface OptionFieldsItem {
  value: string;
  label: string;
  /** Logo shown above the label in `cards` mode (an `<img>` or `<Icon>`). */
  logo?: unknown;
  /** The option's own fields. */
  children?: unknown;
}

/**
 * A choice control plus one `<fieldset>` per option. Only the selected option's group shows (CSS
 * `:has(:checked)`, no script) and the client script disables the others, so they are neither
 * submitted nor validated; typed values in a hidden group are kept. Read the result with
 * `parseOptionFields`.
 */
export const OptionFields: FC<{
  name: string;
  label: string;
  options: OptionFieldsItem[];
  selected?: string;
  variant?: "segmented" | "cards";
}> = ({ name, label, options, selected, variant = "segmented" }) => {
  if (options.length > MAX_OPTIONS) {
    throw new Error(`OptionFields supports at most ${MAX_OPTIONS} options`);
  }
  const current = selected ?? options[0]?.value;
  const cards = variant === "cards";
  return (
    <fieldset class={optionRoot} data-option-fields={name}>
      <legend class={optionLegend}>{label}</legend>
      <div class={cards ? cardBar : choiceBarSelected}>
        {options.map((option) => (
          <>
            <input
              type="radio"
              id={`${name}-${option.value}`}
              name={name}
              value={option.value}
              checked={option.value === current}
              data-option-choice
            />
            <label class={cards ? cardLabel : choiceLabel} for={`${name}-${option.value}`}>
              {cards ? option.logo : null}
              {option.label}
            </label>
          </>
        ))}
      </div>
      <div>
        {options.map((option) => (
          <fieldset
            data-option-group={option.value}
            disabled={option.value === current ? undefined : true}
          >
            <legend class={groupLegend}>{option.label}</legend>
            {option.children}
          </fieldset>
        ))}
      </div>
    </fieldset>
  );
};

export type OptionFieldsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues: z.core.$ZodIssue[] };

type Schemas = Record<string, z.ZodObject>;

const fieldsOf = (schemas: Schemas, name: string): string[] =>
  Object.keys(schemas[name]?.shape ?? {});

/** Fields in `body` that belong to an option other than `selected`. */
function foreignFields(
  body: Record<string, unknown>,
  schemas: Schemas,
  selected: string,
): string[] {
  const own = fieldsOf(schemas, selected);
  return Object.keys(schemas)
    .filter((name) => name !== selected)
    .flatMap((name) => fieldsOf(schemas, name))
    .filter((field) => !own.includes(field) && field in body);
}

function toResult<T>(parsed: ReturnType<z.ZodType["safeParse"]>): OptionFieldsResult<T> {
  if (parsed.success) {
    return { ok: true, value: parsed.data as T };
  }
  return {
    ok: false,
    error: parsed.error.issues[0]?.message ?? "Invalid",
    issues: parsed.error.issues,
  };
}

/**
 * Server side of `OptionFields`: validates the selected option only (a zod `discriminatedUnion`
 * on `key`) and refuses any field that belongs to another option.
 */
export function parseOptionFields<T = Record<string, unknown>>(
  body: Record<string, unknown>,
  key: string,
  schemas: Schemas,
): OptionFieldsResult<T> {
  const selected = body[key];
  if (typeof selected !== "string" || !(selected in schemas)) {
    return { ok: false, error: `Choose a ${key}`, issues: [] };
  }
  const foreign = foreignFields(body, schemas, selected);
  if (foreign.length > 0) {
    return { ok: false, error: `Fields of another ${key}: ${foreign.join(", ")}`, issues: [] };
  }
  const members = Object.keys(schemas).map((name) =>
    z.object({ [key]: z.literal(name) }).extend(schemas[name]?.shape ?? {}),
  );
  return toResult<T>(z.discriminatedUnion(key, members as never).safeParse(body));
}
