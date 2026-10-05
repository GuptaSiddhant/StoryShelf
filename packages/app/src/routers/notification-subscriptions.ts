import { createRoute, z } from "@hono/zod-openapi";
import { NotificationSubscriptionModel } from "@storyshelf/core/models";
import type { NotificationSubscriptionRow } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject, unauthorized } from "./helpers.ts";
import {
  notFound as notFoundResponse,
  notificationSubscriptionPutSchema,
  notificationSubscriptionSchema,
  unauthorized as unauthorizedResponse,
} from "./schemas.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

/** Public subscription view (event/via lists decoded). */
function toPublic(row: NotificationSubscriptionRow): {
  projectId: string;
  userId: string;
  events: string[];
  via: string[];
  enabled: boolean;
} {
  return {
    projectId: row.projectId,
    userId: row.userId,
    events: NotificationSubscriptionModel.eventsOf(row),
    via: NotificationSubscriptionModel.viaOf(row),
    enabled: row.enabled,
  };
}

/** Require a session user (subscriptions are meaningless without identity). */
function currentUserId(): string {
  const user = getStore().user;
  if (!user) {
    unauthorized();
  }
  return user.id;
}

const getSubscriptionRoute = createRoute({
  method: "get",
  tags: ["Notifications"],
  path: "/api/v1/projects/{slug}/notifications/me",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: notificationSubscriptionSchema.nullable() } },
      description: "Your notification subscription (null when never opted in)",
    },
    ...notFoundResponse,
    ...unauthorizedResponse,
  },
});

const putSubscriptionRoute = createRoute({
  method: "put",
  tags: ["Notifications"],
  path: "/api/v1/projects/{slug}/notifications/me",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: notificationSubscriptionPutSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: notificationSubscriptionSchema } },
      description: "Saved notification subscription",
    },
    ...notFoundResponse,
    ...unauthorizedResponse,
  },
});

const deleteSubscriptionRoute = createRoute({
  method: "delete",
  tags: ["Notifications"],
  path: "/api/v1/projects/{slug}/notifications/me",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    204: { description: "Removed notification subscription (opted out)" },
    ...notFoundResponse,
    ...unauthorizedResponse,
  },
});

const listSubscriptionsRoute = createRoute({
  method: "get",
  tags: ["Notifications"],
  path: "/api/v1/projects/{slug}/notifications",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: notificationSubscriptionSchema.array() } },
      description: "List notification subscriptions (admin audit)",
    },
    ...notFoundResponse,
    ...unauthorizedResponse,
  },
});

/** Register the self-service subscription endpoints plus the admin audit list. */
export function registerNotificationSubscriptions(app: ShelfRouter): void {
  app.openapi(getSubscriptionRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    const row = await new NotificationSubscriptionModel(getStore().db).getFor(
      project.id,
      currentUserId(),
    );
    return c.json(row ? toPublic(row) : null);
  });

  app.openapi(putSubscriptionRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    const body = c.req.valid("json");
    const row = await new NotificationSubscriptionModel(getStore().db).upsert(
      project.id,
      currentUserId(),
      body,
    );
    return c.json(toPublic(row));
  });

  app.openapi(deleteSubscriptionRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    await new NotificationSubscriptionModel(getStore().db).remove(project.id, currentUserId());
    return c.body(null, 204);
  });

  app.openapi(listSubscriptionsRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const rows = await new NotificationSubscriptionModel(getStore().db).list(project.id);
    return c.json(rows.map((row) => toPublic(row)));
  });
}
