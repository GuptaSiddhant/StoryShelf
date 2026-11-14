/**
 * Web push device registration (ADR 0048, decision 4): the VAPID public key, and a signed-in user's
 * own devices. All three answer 404 without VAPID keys. A device is a browser endpoint plus its two
 * keys; the answers never return them, and nothing here logs them.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { MAX_ENDPOINT_LENGTH, pushChannelConfigSchema } from "@storyshelf/core/integrations/push";
import { PushSubscriptionModel } from "@storyshelf/core/models";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { notFound, unauthorized } from "./helpers.ts";
import {
  errorSchema,
  notFound as notFoundResponse,
  unauthorized as unauthorizedResponse,
} from "./schemas.ts";

/** Longest label a device carries ("Work laptop"). */
const MAX_LABEL = 100;

const publicKeySchema = z.object({ publicKey: z.string() }).openapi("PushPublicKey");

/** What a browser's `PushSubscription.toJSON()` holds, plus a label. Checked in full by the handler. */
const registerSchema = z
  .object({
    endpoint: z.string().min(1),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
    label: z.string().trim().max(MAX_LABEL).optional(),
  })
  .openapi("PushSubscriptionInput");

const deviceSchema = z
  .object({ id: z.string(), label: z.string().nullable(), createdAt: z.string() })
  .openapi("PushDevice");

const publicKeyRoute = createRoute({
  method: "get",
  tags: ["Notifications"],
  summary: "Web push public key",
  description:
    "The VAPID public key a browser subscribes with (`applicationServerKey`). 404 when web push is not configured.",
  path: "/api/v1/push/public-key",
  responses: {
    200: {
      content: { "application/json": { schema: publicKeySchema } },
      description: "The VAPID public key (base64url)",
    },
    ...notFoundResponse,
  },
});

const registerRoute = createRoute({
  method: "post",
  tags: ["Notifications"],
  summary: "Register this device for web push",
  description:
    "Stores a browser's push subscription for the signed-in user; the same endpoint registered again replaces its keys, owner and label. The endpoint must be `https:` (at most 512 characters), `p256dh` an uncompressed P-256 point and `auth` 16 bytes, both base64url. A device receives push only for the notification subscriptions that list `push` in `via`. 404 when web push is not configured.",
  path: "/api/v1/me/push-subscriptions",
  request: { body: { content: { "application/json": { schema: registerSchema } } } },
  responses: {
    201: {
      content: { "application/json": { schema: deviceSchema } },
      description: "The registered device",
    },
    422: {
      content: { "application/json": { schema: errorSchema } },
      description: "Not a valid push subscription",
    },
    ...notFoundResponse,
    ...unauthorizedResponse,
  },
});

const deleteRoute = createRoute({
  method: "delete",
  tags: ["Notifications"],
  summary: "Remove one of my push devices",
  path: "/api/v1/me/push-subscriptions/{id}",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "The device is removed" },
    ...notFoundResponse,
    ...unauthorizedResponse,
  },
});

/** The server's VAPID identity, or a 404: without keys the push routes do not exist. */
function pushOrNotFound(): NonNullable<ReturnType<typeof getStore>["push"]> {
  const { push } = getStore();
  if (push === undefined) {
    notFound();
  }
  return push;
}

/** The signed-in user's id; a device belongs to a person, so anonymous callers get 401. */
function userIdOrUnauthorized(): string {
  const { user } = getStore();
  if (!user) {
    unauthorized();
  }
  return user.id;
}

/** Register the web push routes. */
export function registerPush(app: ShelfRouter): void {
  app.openapi(publicKeyRoute, (c) => c.json({ publicKey: pushOrNotFound().publicKey }, 200));

  app.openapi(registerRoute, async (c) => {
    pushOrNotFound();
    const userId = userIdOrUnauthorized();
    const body = c.req.valid("json");
    const device = pushChannelConfigSchema.safeParse({ endpoint: body.endpoint, ...body.keys });
    if (!device.success) {
      throw new HTTPException(422, { message: "Not a valid push subscription" });
    }
    const row = await new PushSubscriptionModel(getStore().db).add(userId, {
      ...device.data,
      label: body.label === undefined || body.label === "" ? null : body.label,
    });
    return c.json({ id: row.id, label: row.label, createdAt: row.createdAt }, 201);
  });

  app.openapi(deleteRoute, async (c) => {
    pushOrNotFound();
    const userId = userIdOrUnauthorized();
    const removed = await new PushSubscriptionModel(getStore().db).removeOwned(
      userId,
      c.req.valid("param").id,
    );
    if (!removed) {
      notFound();
    }
    return c.body(null, 204);
  });
}

/**
 * Delete the signed-in user's device with this endpoint (sign-out: the worker unsubscribed it just
 * before and names it). Another person's device, an unknown endpoint and any failure are ignored:
 * signing out never waits on, or fails for, push.
 */
export async function forgetPushDevice(endpoint?: string): Promise<void> {
  const { user, db, logger } = getStore();
  if (!user || !endpoint || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return;
  }
  try {
    const devices = new PushSubscriptionModel(db);
    const row = await devices.findByEndpoint(endpoint);
    if (row?.userId === user.id) {
      await devices.remove(row.id);
    }
  } catch (error) {
    logger.warn({ err: error }, "push device could not be forgotten at sign-out");
  }
}
