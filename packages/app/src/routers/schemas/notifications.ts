/** Webhook, notification channel and notification subscription schemas. */
import { z } from "@hono/zod-openapi";
import { WebhookModel } from "@storyshelf/core/models";

/** OpenAPI schema for a public webhook (secret omitted). */
export const webhookPublicSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
  })
  .openapi("Webhook");

// oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
const webhookUrlBase = z.string().url();

/** OpenAPI schema for creating a webhook. */
export const webhookCreateSchema = z
  .object({
    url: webhookUrlBase.refine((url) => WebhookModel.urlError(url) === null, {
      message: "URL must use http or https",
    }),
    events: z.array(z.string().min(1)).optional(),
  })
  .openapi("WebhookCreateInput");

/** OpenAPI schema for a newly created webhook including its signing secret. */
export const webhookCreatedSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
    secret: z.string(),
  })
  .openapi("WebhookCreated");

/** OpenAPI schema for a public notification channel (secret omitted). */
export const notificationChannelSchema = z
  .object({
    id: z.string(),
    projectId: z.string().nullable(),
    provider: z.string(),
    config: z.record(z.string(), z.unknown()),
    hasSecret: z.boolean(),
    events: z.array(z.string()),
    enabled: z.boolean(),
    lastError: z.string().nullable(),
    lastErrorAt: z.string().nullable(),
    lastDeliveredAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("NotificationChannel");

/** OpenAPI schema for creating a notification channel. */
export const notificationChannelCreateSchema = z
  .object({
    provider: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    secret: z.string().min(1).optional(),
    events: z.array(z.string().min(1)).optional(),
    enabled: z.boolean().optional(),
  })
  .openapi("NotificationChannelCreateInput");

/** OpenAPI schema for a per-user notification subscription. */
export const notificationSubscriptionSchema = z
  .object({
    projectId: z.string(),
    userId: z.string(),
    events: z.array(z.string()),
    via: z.array(z.string()),
    enabled: z.boolean(),
    reviewRequests: z.boolean(),
  })
  .openapi("NotificationSubscription");

/** OpenAPI schema for setting your own notification subscription. */
export const notificationSubscriptionPutSchema = z
  .object({
    events: z.array(z.string().min(1)).optional(),
    via: z.array(z.string().min(1)).optional(),
    enabled: z.boolean().optional(),
    /** `review:requested` on or off; left as stored when omitted. */
    reviewRequests: z.boolean().optional(),
  })
  .openapi("NotificationSubscriptionPutInput");
