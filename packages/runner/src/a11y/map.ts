/** Map slim in-page axe results to `a11y:` violation strings. */

/** Most violations reported per snapshot; the rest collapse into "…and N more". */
export const MAX_REPORTED_VIOLATIONS = 10;
const MAX_SELECTOR_LENGTH = 60;
const MAX_HELP_LENGTH = 90;
const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"];

/** The only per-violation fields that leave the page (raw axe nodes carry large html payloads). */
export interface SlimViolation {
  id: string;
  impact: string | null;
  help: string;
  /** Selector of the first affected node. */
  target: string;
  /** Number of affected nodes. */
  count: number;
}

/**
 * One string per violation: rule id, impact, help text, short target and node count, worst impact
 * first. `;` is reserved (the pipeline joins annotations with it), so it never appears in a string.
 */
export function mapAxeViolations(violations: readonly SlimViolation[]): string[] {
  const sorted = violations.toSorted(compareViolations);
  const lines = sorted
    .slice(0, MAX_REPORTED_VIOLATIONS)
    .map((violation) => formatViolation(violation));
  const more = sorted.length - lines.length;
  if (more > 0) lines.push(`…and ${more} more`);
  return lines;
}

function formatViolation(v: SlimViolation): string {
  const nodes = `${v.count} node${v.count === 1 ? "" : "s"}`;
  const target = truncate(v.target, MAX_SELECTOR_LENGTH);
  return clean(
    `${v.id} (${v.impact ?? "unknown"}): ${truncate(v.help, MAX_HELP_LENGTH)} [${target}] ${nodes}`,
  );
}

function compareViolations(a: SlimViolation, b: SlimViolation): number {
  return rank(a.impact) - rank(b.impact) || a.id.localeCompare(b.id);
}

function rank(impact: string | null): number {
  const index = IMPACT_ORDER.indexOf(impact ?? "");
  return index === -1 ? IMPACT_ORDER.length : index;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clean(text: string): string {
  return text.replaceAll(/\s+/gu, " ").replaceAll(";", ",");
}
