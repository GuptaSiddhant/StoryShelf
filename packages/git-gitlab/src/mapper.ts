import type { CheckStatus } from "@storyshelf/core";

/** Map a StoryShelf check status to a GitLab pipeline status. */
export function mapStatus(status: CheckStatus): string {
  switch (status) {
    case "pending": {
      return "pending";
    }
    case "success": {
      return "success";
    }
    case "failure": {
      return "failed";
    }
    default: {
      return "failed";
    }
  }
}
