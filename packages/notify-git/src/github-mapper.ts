import type { NotifierState } from "@storyshelf/core/adapter/notifier";

/** Map a StoryShelf build state to a GitHub commit state. */
export function mapState(state: NotifierState): "pending" | "success" | "failure" | "error" {
  switch (state) {
    case "pending": {
      return "pending";
    }
    case "success": {
      return "success";
    }
    case "failure": {
      return "failure";
    }
    default: {
      return "error";
    }
  }
}
