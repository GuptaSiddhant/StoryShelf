import { NotificationChannelModel, WebhookModel } from "@storyshelf/core/models";
import { credentialKeys } from "../credential-keys.ts";
import { getStore } from "../store.ts";

/** Models that encrypt secrets at rest, bound to the current request's db and server secret. */

/** Webhook model for the current request. */
export function webhookModel(): WebhookModel {
  const { db, config } = getStore();
  return new WebhookModel(db, undefined, credentialKeys(config));
}

/** Notification-channel model for the current request. */
export function notificationChannelModel(): NotificationChannelModel {
  const { db, config } = getStore();
  return new NotificationChannelModel(db, undefined, credentialKeys(config));
}
