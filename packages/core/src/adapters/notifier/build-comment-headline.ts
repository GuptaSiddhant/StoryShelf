import { commitCode, escapeText, plural } from "./build-comment-text.ts";
/** The headline (one state, one emoji) and the action links of the pull-request comment. */
import type { BuildCommentInput } from "./build-comment-types.ts";

/**
 * ` by \`name\``: the display name in a code span, so it never pings a git host user. Every
 * whitespace run (newlines included) becomes one space, so a name with a blank line cannot end the
 * span early; a backtick is dropped. A name that is empty after that shows no byline.
 */
function byline(reviewer: string | undefined): string {
  const name = reviewer?.replaceAll("`", "").replaceAll(/\s+/gu, " ").trim();
  return name === undefined || name === "" ? "" : ` by \`${name}\``;
}

/**
 * Changes still waiting for a verdict. The stored `changedCount` already holds only the open
 * snapshots (`changed` or `new`); `approvedCount` also holds `unchanged` ones, so no verdict count
 * is subtracted from it.
 */
export function openChanges(counts: Pick<BuildCommentInput["counts"], "changedCount">): number {
  return counts.changedCount;
}

/** Emoji and text of the state; the build status decides, never the accessibility count. */
export function headlineOf(input: BuildCommentInput): { emoji: string; text: string } {
  switch (input.status) {
    case "approved": {
      return { emoji: "✅", text: `Approved${byline(input.reviewer)}` };
    }
    case "rejected": {
      return { emoji: "❌", text: `Rejected${byline(input.reviewer)}` };
    }
    case "failed": {
      const why = input.failure === undefined ? "" : ` (${escapeText(input.failure)})`;
      return { emoji: "⚠️", text: `${input.testing ? "Capture" : "Build"} failed${why}` };
    }
    case "cancelled": {
      const newer = input.supersededBy;
      return {
        emoji: "⚪",
        text:
          newer === undefined
            ? "Cancelled"
            : `Cancelled: superseded by [${commitCode(newer.sha)}](${newer.url})`,
      };
    }
    default: {
      return pendingHeadline(input);
    }
  }
}

function pendingHeadline(input: BuildCommentInput): { emoji: string; text: string } {
  if (!input.testing) {
    return { emoji: "🟡", text: "Waiting for review" };
  }
  if (input.status !== "reviewing") {
    return { emoji: "⏳", text: "Capturing" };
  }
  const open = openChanges(input.counts);
  return {
    emoji: "🟡",
    text: `${plural(open, "visual change")} ${open === 1 ? "needs" : "need"} review`,
  };
}

/** `1 of 2 approvals` while a review with several approvers waits. */
export function approvalsText(input: BuildCommentInput): string | undefined {
  const { approvals, status } = input;
  if (approvals === undefined || approvals.required <= 1 || status === "approved") {
    return undefined;
  }
  return `${String(approvals.given)} of ${String(approvals.required)} approvals`;
}

/** A verdict is still to be given (a failed, cancelled or closed build waits for none). */
function awaitsVerdict(input: BuildCommentInput): boolean {
  if (input.testing) {
    return input.status === "reviewing";
  }
  return !["approved", "rejected", "failed", "cancelled"].includes(input.status);
}

/** The first link: review, or for a failed capture its log and retry. */
function leadLinks(input: BuildCommentInput): string[] {
  if (input.status !== "failed") {
    return [`[**Review changes →**](${input.reviewUrl})`];
  }
  return [
    ...(input.logUrl === undefined ? [] : [`[Build log](${input.logUrl})`]),
    ...(input.retryUrl === undefined ? [] : [`[Retry capture](${input.retryUrl})`]),
  ];
}

/** The links under the headline: review, Storybook, build, and the retry of a failed capture. */
export function actionLinks(input: BuildCommentInput): string {
  return [
    ...leadLinks(input),
    ...(awaitsVerdict(input) ? [`[Approve on StoryShelf](${input.reviewUrl})`] : []),
    ...(input.storybookUrl === undefined ? [] : [`[Storybook](${input.storybookUrl})`]),
    ...(input.buildUrl === input.reviewUrl ? [] : [`[Build](${input.buildUrl})`]),
  ].join(" · ");
}
