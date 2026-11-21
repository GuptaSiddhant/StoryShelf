/** Text helpers of the pull-request comment: escaping, counts and the UTC time. */

/** Characters that would change the Markdown of a cell or a link text, escaped with a backslash. */
const MARKDOWN_SPECIAL = /[\\`*_{}[\]<>|#]/gu;

/** A zero-width joiner: after an `@` it keeps GitHub and GitLab from reading a mention. */
const INERT_AT = "@\u200D";

/** A bare link start: `://` or `www.` after which GitHub and GitLab would autolink. */
const AUTOLINK_START = /:\/\/|\bwww\./giu;

/** A zero-width joiner that breaks an autolink without changing how the text reads. */
const JOINER = "\u200D";

/**
 * Text from a story or a user, safe in a table cell or a link text on GitHub and GitLab. An `@`
 * never starts a mention (a story named `@acme/button` must not notify a git host user or team),
 * a bare URL never becomes a link and `&` never starts an entity.
 */
export function escapeText(text: string): string {
  return text
    .replaceAll(/\s+/gu, " ")
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll(MARKDOWN_SPECIAL, "\\$&")
    .replaceAll(AUTOLINK_START, (start) => `${start}${JOINER}`)
    .replaceAll("@", INERT_AT);
}

/**
 * A commit id as an inline code span. Escaping cannot protect text inside a code span (a backtick
 * ends it whatever precedes it), so only characters a commit id can hold are kept: a row written
 * before the create routes validated `gitSha` cannot break out of the span or mention anyone.
 */
export function commitCode(sha: string): string {
  return `\`${sha.replaceAll(/[^0-9A-Za-z-]/gu, "")}\``;
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
