/**
 * Value conversion between Better Auth models and driver rows.
 *
 * Better Auth speaks Dates; our TEXT columns store ISO strings. All
 * conversion is explicit per-field (declared date fields) — no heuristics.
 */

/** Convert one inbound value to its driver representation. */
export function toDriverValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/** Drop undefined keys (matches the repo's withoutUndefined convention). */
export function stripUndefined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter((pair) => pair[1] !== undefined));
}

/** Convert a model row to its driver representation (Dates to ISO). */
export function toDriverRow(values: Record<string, unknown>): Record<string, unknown> {
  return stripUndefined(
    Object.fromEntries(
      Object.entries(values).map(([field, value]) => [field, toDriverValue(value)]),
    ),
  );
}

/** Revive ISO strings back to Dates for declared date fields. */
export function toModelRow(
  row: Record<string, unknown>,
  dateFields: readonly string[],
): Record<string, unknown> {
  const out = { ...row };
  for (const field of dateFields) {
    const value = out[field];
    if (typeof value === "string") {
      out[field] = new Date(value);
    }
  }
  return out;
}

/** Project a row down to the requested model fields, if any. */
export function applySelect(
  row: Record<string, unknown>,
  select: readonly string[] | undefined,
): Record<string, unknown> {
  if (!select || select.length === 0) {
    return row;
  }
  return Object.fromEntries(select.map((field) => [field, row[field]]));
}
