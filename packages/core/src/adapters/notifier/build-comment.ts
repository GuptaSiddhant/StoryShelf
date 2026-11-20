/** Markdown of the pull-request comment, derived from the same inputs as the statuses (ADR 0014, decision 6). */
import {
  changesSection,
  detailsSummary,
  failedTestsSection,
  removedSection,
} from "./build-comment-changes.ts";
import { actionLinks, approvalsText, headlineOf } from "./build-comment-headline.ts";
import { utcTime } from "./build-comment-text.ts";
import type { BuildCommentInput } from "./build-comment-types.ts";

export type {
  BuildCommentInput,
  CommentChange,
  CommentEarlierBuild,
} from "./build-comment-types.ts";

/** The body stays under this many characters (hosts cap a comment at 65,536); lists are cut first. */
export const MAX_COMMENT_CHARS = 60_000;

/**
 * Comment body (below the idempotency marker): a headline with one state, the links, the changed
 * stories, and a footer. An approved build shrinks to one line. A body over the cap loses rows of
 * its lists (the `<details>` rows, then history), never its headline or links.
 */
export function buildCommentMarkdown(input: BuildCommentInput): string {
  let hidden = input.changes?.length ?? 0;
  let history = input.earlier?.length ?? 0;
  let body = render(input, hidden, history);
  while (body.length > MAX_COMMENT_CHARS && (hidden > 0 || history > 0)) {
    hidden = Math.floor(hidden / 2);
    history = Math.floor(history / 2);
    body = render(input, hidden, history);
  }
  return body;
}

function render(input: BuildCommentInput, hidden: number, history: number): string {
  const { emoji, text } = headlineOf(input);
  const links = actionLinks(input);
  if (input.status === "approved") {
    return `### ${emoji} StoryShelf: ${text} · ${links}`;
  }
  const heading = `### ${emoji} StoryShelf: ${text}`;
  const approvals = approvalsText(input);
  return [
    heading,
    links,
    ...(approvals === undefined ? [] : [approvals]),
    ...failedTestsSection(input.failedTests),
    ...changesSection(input.changes ?? [], hidden),
    ...removedSection(input.removed),
    ...closingDetails(input, history),
    footer(input),
  ].join("\n\n");
}

function closingDetails(input: BuildCommentInput, history: number): string[] {
  const summary = detailsSummary(input);
  if (summary === undefined) {
    return [];
  }
  const lines = (input.earlier ?? [])
    .slice(0, history)
    .map((build) => `- ${build.state} · [\`${build.sha}\`](${build.url})`);
  const more = (input.earlier?.length ?? 0) - lines.length;
  const body = [...lines, ...(more > 0 ? [`- …and ${String(more)} more`] : [])];
  if (body.length === 0) {
    return [summary];
  }
  return [`<details><summary>${summary}</summary>\n\n${body.join("\n")}\n\n</details>`];
}

/** `Commit abc1234 · partial capture (12 of 120 stories) · updated 16:42 UTC`, small. */
function footer(input: BuildCommentInput): string {
  const { capture } = input;
  const partial =
    capture !== undefined && capture.rendered < capture.total
      ? `partial capture (${String(capture.rendered)} of ${String(capture.total)} stories)`
      : capture === undefined
        ? undefined
        : "full capture";
  const time = utcTime(input.updatedAt);
  const parts = [
    `Commit \`${input.sha}\``,
    ...(partial === undefined ? [] : [partial]),
    ...(time === undefined ? [] : [`updated ${time}`]),
  ];
  return `<sub>${parts.join(" · ")}</sub>`;
}

/** The one line of a skipped build (ADR 0044): it repeats the build it names. */
export function skippedCommentMarkdown(input: {
  buildUrl: string;
  /** The compared build's short commit and page; absent when that build no longer exists. */
  source?: { sha: string; url: string } | undefined;
}): string {
  const compared =
    input.source === undefined
      ? "a build that no longer exists"
      : `[\`${input.source.sha}\`](${input.source.url})`;
  return `### ⏭️ StoryShelf: Skipped: no story changed since ${compared} · [Build](${input.buildUrl})`;
}
