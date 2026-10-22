import type { NotifierState } from "@storyshelf/core/adapter/notifier";

/** GitLab's pipeline statuses; a cancelled build is GitLab's own `canceled`. */
const STATES: Record<NotifierState, "pending" | "success" | "failed" | "canceled"> = {
  pending: "pending",
  success: "success",
  failure: "failed",
  cancelled: "canceled",
};

/** Map a StoryShelf build state to a GitLab pipeline status; an unknown state is `failed`. */
export function mapState(state: NotifierState): "pending" | "success" | "failed" | "canceled" {
  return STATES[state] ?? "failed";
}
