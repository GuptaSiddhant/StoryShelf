import { escapeText, plural } from "./build-comment-text.ts";
/** The changed-stories table, the lists beside it, and the details block of the pull-request comment. */
import type { BuildCommentInput, CommentChange } from "./build-comment-types.ts";

/** Rows shown before the rest go into a `<details>` block. */
export const ROWS_SHOWN = 10;

function storiesWord(count: number): string {
  return count === 1 ? "story" : "stories";
}

function rowOf(change: CommentChange): string {
  const links = [
    `[review](${change.reviewUrl})`,
    ...(change.storyUrl === undefined ? [] : [`[story](${change.storyUrl})`]),
  ];
  return `| ${escapeText(change.story)} | ${escapeText(change.target)} | ${escapeText(change.change)} | ${links.join(" · ")} |`;
}

function tableOf(rows: readonly CommentChange[]): string {
  return [
    "| Story | Target | Change | |",
    "|---|---|---|---|",
    ...rows.map((row) => rowOf(row)),
  ].join("\n");
}

/**
 * The first {@link ROWS_SHOWN} changes as a table; at most `hidden` of the rest go in a `<details>`
 * table, and what does not fit is counted, so the caller can cut the body to its size.
 */
export function changesSection(changes: readonly CommentChange[], hidden: number): string[] {
  if (changes.length === 0) {
    return [];
  }
  const blocks = [tableOf(changes.slice(0, ROWS_SHOWN))];
  const rest = changes.slice(ROWS_SHOWN);
  if (rest.length > 0) {
    const listed = rest.slice(0, hidden);
    const more = rest.length - listed.length;
    blocks.push(
      [
        `<details><summary>${String(rest.length)} more changed ${storiesWord(rest.length)}</summary>`,
        ...(listed.length === 0 ? [] : ["", tableOf(listed)]),
        ...(more > 0 ? ["", `…and ${String(more)} more: open the review page.`] : []),
        "",
        "</details>",
      ].join("\n"),
    );
  }
  return blocks;
}

/**
 * Failing Storybook tests come first and in full view. A failing test fails the build, which is what
 * blocks the merge (`statusesForBuild` reads the build status, never a test result), except for a
 * test of a story marked flaky: that one is logged, never blocking. The stored results do not say
 * which is which, so the label says so rather than claiming a block for every one.
 */
export function failedTestsSection(names?: readonly string[]): string[] {
  if (names === undefined || names.length === 0) {
    return [];
  }
  const shown = names.slice(0, ROWS_SHOWN).map((name) => `- ${escapeText(name)}`);
  const rest = names.length - shown.length;
  return [
    [
      `**❌ ${plural(names.length, "failing Storybook test")}** (blocks the merge unless its story is marked flaky)`,
      ...shown,
      ...(rest > 0 ? [`- …and ${String(rest)} more`] : []),
    ].join("\n"),
  ];
}

/** Removed stories, as one short list. */
export function removedSection(titles: readonly string[] | undefined): string[] {
  if (titles === undefined || titles.length === 0) {
    return [];
  }
  const shown = titles.slice(0, ROWS_SHOWN).map((title) => `- ${escapeText(title)}`);
  const rest = titles.length - shown.length;
  return [
    [
      `**${String(titles.length)} removed ${storiesWord(titles.length)}**`,
      ...shown,
      ...(rest > 0 ? [`- …and ${String(rest)} more`] : []),
    ].join("\n"),
  ];
}

/** `117 unchanged · 2 a11y findings · 1 earlier build`: the summary of the closing details block. */
export function detailsSummary(input: BuildCommentInput): string | undefined {
  const { counts } = input;
  const parts = [
    ...(input.testing &&
    ["reviewing", "approved", "rejected"].includes(input.status) &&
    counts.snapshotCount > counts.changedCount
      ? [`${String(counts.snapshotCount - counts.changedCount)} unchanged`]
      : []),
    ...((input.a11yCount ?? 0) > 0 ? [plural(input.a11yCount ?? 0, "a11y finding")] : []),
    ...((input.earlier?.length ?? 0) > 0
      ? [plural(input.earlier?.length ?? 0, "earlier build")]
      : []),
  ];
  return parts.length === 0 ? undefined : parts.join(" · ");
}
