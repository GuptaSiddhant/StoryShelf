import type { CheckStatus } from "@storyshelf/core";

export function mapStatus(status: CheckStatus): "pending" | "success" | "failure" | "error" {
  switch (status) {
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
