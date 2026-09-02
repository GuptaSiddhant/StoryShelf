import type { CheckStatus } from "@storyshelf/core";

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
