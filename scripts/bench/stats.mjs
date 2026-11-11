// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/** Median and report helpers for the benchmark (issue #853). */

export function median(values) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The median of each numeric leaf across runs that share one shape. Arrays and strings are taken
 * from the run whose value sits closest to the median of the first numeric leaf found, so a list
 * such as "slowest queries" stays one real run's data rather than a blend.
 */
export function medianOf(runs) {
  const [first] = runs;
  if (typeof first === "number") return median(runs);
  if (Array.isArray(first) || typeof first !== "object" || first === null) return first;
  return Object.fromEntries(
    Object.keys(first).map((key) => [key, medianOf(runs.map((run) => run?.[key]))]),
  );
}

/** Rows of `[label, ...cells]` as an aligned text table. */
export function table(header, rows) {
  const all = [header, ...rows].map((row) => row.map(String));
  const widths = header.map((_cell, at) => Math.max(...all.map((row) => row[at].length)));
  const line = (row) => row.map((cell, at) => cell.padEnd(widths[at])).join("  ");
  return [
    line(all[0]),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...all.slice(1).map(line),
  ].join("\n");
}
