/**
 * Chat notification providers: formatted build and admin alerts over
 * Slack and Teams incoming webhooks (plus a log provider for tests/dev).
 */
import { logNotifier } from "./log.ts";
import { slackWebhookNotifier } from "./slack.ts";
import { teamsWorkflowNotifier } from "./teams.ts";

/** Slack incoming-webhook provider (`slack-webhook`). */
export { slackWebhookNotifier };
/** Teams workflow-webhook provider (`teams-workflow`). */
export { teamsWorkflowNotifier };
/** Log-only provider for tests, dev, and unconfigured servers (`log`). */
export { logNotifier };

/** All chat providers in one list for `ShelfOptions.notifiers`. */
export const chatNotifiers = [slackWebhookNotifier, teamsWorkflowNotifier, logNotifier];

export type { ChatToggles } from "./types.ts";
export { chatTogglesSchema } from "./types.ts";
export { logConfigSchema } from "./log.ts";
export { slackWebhookConfigSchema } from "./slack.ts";
export { teamsWorkflowConfigSchema } from "./teams.ts";
