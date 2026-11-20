/** Text helpers of the pull-request comment: escaping, counts and the UTC time. */

/** Characters that would change the Markdown of a cell or a link text, escaped with a backslash. */
const MARKDOWN_SPECIAL = /[\\`*_{}[\]<>|#]/gu;

/** Text from a story or a user, safe in a table cell or a link text on GitHub and GitLab. */
export function escapeText(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim().replaceAll(MARKDOWN_SPECIAL, "\\$&");
}

/** `1 change`, `3 changes`. */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** A diff ratio (0 to 1) as `2.4 %`, never `0.0 %` for a real change. */
export function percentOf(ratio: number | null | undefined): string | undefined {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return undefined;
  }
  const percent = ratio * 100;
  return `${(percent > 0 && percent < 0.1 ? 0.1 : percent).toFixed(1)} %`;
}

/** `16:42 UTC` from an ISO time; undefined when it does not parse. */
export function utcTime(iso?: string): string | undefined {
  const at = iso === undefined ? Number.NaN : Date.parse(iso);
  return Number.isNaN(at) ? undefined : `${new Date(at).toISOString().slice(11, 16)} UTC`;
}
