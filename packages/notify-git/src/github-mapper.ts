import type { NotifierState } from "@storyshelf/core/adapter/notifier";

/**
 * GitHub's commit states. It has no cancelled state, so a cancelled build shows `error`, its
 * "did not complete" state.
 */
const STATES: Record<NotifierState, "pending" | "success" | "failure" | "error"> = {
  pending: "pending",
  success: "success",
  failure: "failure",
  cancelled: "error",
};

/** Map a StoryShelf build state to a GitHub commit state; an unknown state is `error`. */
export function mapState(state: NotifierState): "pending" | "success" | "failure" | "error" {
  return STATES[state] ?? "error";
}
