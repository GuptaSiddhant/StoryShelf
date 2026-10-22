/** Human text for a build state and the comment marker shared by GitHub and GitLab. */
import type { NotifierState } from "@storyshelf/core/adapter/notifier";

/** Short description shown beside a commit status. */
export function describeState(state: NotifierState): string {
  switch (state) {
    case "pending": {
      return "Visual tests pending";
    }
    case "success": {
      return "Visual tests passed";
    }
    case "cancelled": {
      return "Cancelled";
    }
    default: {
      return "Visual changes detected or tests failed";
    }
  }
}

/** Hidden marker that keys the single comment per build (idempotent upsert). */
export function commentMarker(url: string): string {
  return `<!-- storyshelf:${url} -->`;
}
