/**
 * Event subscriptions: which events a webhook, notification channel or per-user subscription
 * admits (ADR 0013, decision 10). One rule for every filter, so the alias cannot drift.
 */

/** The one event raised for every comment; its `data.scope` is `build`, `story` or `snapshot`. */
export const COMMENT_CREATED = "comment:created";

/**
 * Raised once per member a comment mentions (#463), to that member only: a directed notification,
 * never a webhook, and never delivered to a channel that others read.
 */
export const COMMENT_MENTIONED = "comment:mentioned";

/**
 * `review:comment` is a filter alias, never an emitted event: a filter that lists it matches a
 * {@link COMMENT_CREATED} whose scope is `build` or `story`.
 */
export const REVIEW_COMMENT_ALIAS = "review:comment";

/** One topic a person can subscribe to: its event name and the label a settings page shows. */
export interface NotificationEvent {
  event: string;
  label: string;
}

/**
 * Every project event a person can subscribe to, in the order a settings page lists them: the one
 * list the subscription form renders and compares against, so a new event shows up there without a
 * second edit. Not here: `review:comment` (a filter alias, never emitted), `comment:mentioned`
 * (addressed to one member, never a subscription) and the `sys:*` admin events.
 */
export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  { event: "build:created", label: "Build created" },
  { event: "build:reviewing", label: "Build needs review" },
  { event: "build:approved", label: "Build approved" },
  { event: "build:rejected", label: "Build rejected" },
  { event: "build:pending", label: "Build sent back to pending" },
  { event: "build:failed", label: "Build failed" },
  { event: "build:cancelled", label: "Build cancelled" },
  { event: "baseline:created", label: "Baseline created" },
  { event: "baseline:updated", label: "Baseline updated" },
  { event: COMMENT_CREATED, label: "Comment posted" },
  { event: "review:requested", label: "Review requested" },
  { event: "review:verdict", label: "Review verdict" },
  { event: "design:changed", label: "Design changed" },
  { event: "insight:ready", label: "Insight ready" },
];

/**
 * Whether a subscription list admits an event. An empty list admits everything; otherwise the
 * event name must be listed, or the list holds the `review:comment` alias and the event is a
 * build or story comment. A list holding both names admits the event once (a boolean, not a count).
 *
 * @param subscribed - The names the webhook, channel or subscription filters on.
 * @param event - The emitted event name.
 * @param data - The event payload (`scope` decides the alias).
 */
export function matchesEvent(
  subscribed: readonly string[],
  event: string,
  data: Record<string, unknown>,
): boolean {
  if (subscribed.length === 0 || subscribed.includes(event)) {
    return true;
  }
  const reviewScope = data["scope"] === "build" || data["scope"] === "story";
  return event === COMMENT_CREATED && reviewScope && subscribed.includes(REVIEW_COMMENT_ALIAS);
}
