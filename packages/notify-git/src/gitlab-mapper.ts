import type { NotifierState } from "@storyshelf/core/adapter/notifier";

/** Map a StoryShelf build state to a GitLab pipeline status. */
export function mapState(state: NotifierState): "pending" | "success" | "failed" {
  switch (state) {
    case "pending": {
      return "pending";
    }
    case "success": {
      return "success";
    }
    default: {
      return "failed";
    }
  }
}
