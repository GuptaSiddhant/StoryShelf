/**
 * @deprecated The chat providers are built into `@storyshelf/core` (ADR 0049) and registered by
 * default. This package re-exports them until it is retired; import from
 * `@storyshelf/core/integrations` instead.
 */
export {
  chatNotifiers,
  chatTogglesSchema,
  logConfigSchema,
  logNotifier,
  slackWebhookConfigSchema,
  slackWebhookNotifier,
  teamsWorkflowConfigSchema,
  teamsWorkflowNotifier,
  type ChatToggles,
} from "@storyshelf/core/integrations";
