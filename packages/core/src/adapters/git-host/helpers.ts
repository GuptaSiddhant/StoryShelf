import type { CheckStatus } from "./index.ts";

/** Human description for a check status — shared across GitHub/GitLab. */
export function describeStatus(status: CheckStatus): string {
  switch (status) {
    case "pending": {
      return "Visual tests pending";
    }
    case "success": {
      return "Visual tests passed";
    }
    case "failure": {
      return "Visual changes detected or tests failed";
    }
    default: {
      return "Visual changes detected or tests failed";
    }
  }
}

/** Markdown comment body helpers — single comment per build, idempotent via marker. */
export function commentMarker(url: string): string {
  return `<!-- storyshelf:${url} -->`;
}

export function buildCommentMarkdown(status: CheckStatus, url: string, context: string): string {
  switch (status) {
    case "pending": {
      return `Visual tests pending for \`${context}\` — [View build](${url})`;
    }
    case "success": {
      return `Visual tests passed for \`${context}\` — [View build](${url})`;
    }
    case "failure": {
      return `Visual changes detected for \`${context}\` — [View build](${url})`;
    }
    default: {
      return `Visual tests \`${status}\` for \`${context}\` — [View build](${url})`;
    }
  }
}
