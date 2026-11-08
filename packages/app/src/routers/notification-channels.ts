import { createRoute, z } from "@hono/zod-openapi";
import { NotificationChannelModel } from "@storyshelf/core/models";
import type { NotificationChannelRow } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import { sanitizeErrorText } from "@storyshelf/core/utils";
import type { ShelfRouter } from "../app-types.ts";
import { errorBody } from "../middleware/api-errors.ts";
import { getStore } from "../store.ts";
import { retryChannelState } from "./channel-retry.ts";
import { notFound, requireSiteAdmin, resolveAuthorizedProject } from "./helpers.ts";
import {
  errorSchema,
  notFound as notFoundResponse,
  notificationChannelCreateSchema,
  notificationChannelSchema,
  unauthorized,
} from "./schemas.ts";
import { notificationChannelModel } from "./scoped-models.ts";
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

/** Public channel view (secret redacted, config/events decoded). */
function toPublic(row: NotificationChannelRow): {
  id: string;
  projectId: string | null;
  provider: string;
  config: Record<string, unknown>;
  hasSecret: boolean;
  events: string[];
  enabled: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastDeliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    config: NotificationChannelModel.configOf(row),
    hasSecret: row.secretEncrypted !== null,
    events: NotificationChannelModel.eventsOf(row),
    enabled: row.enabled,
    lastError: row.lastError === null ? null : sanitizeErrorText(row.lastError, 500),
    lastErrorAt: row.lastErrorAt,
    lastDeliveredAt: row.lastDeliveredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const listChannelsRoute = createRoute({
  method: "get",
  tags: ["Notifications"],
  summary: "List notification channels",
  path: "/api/v1/projects/{slug}/notification-channels",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: notificationChannelSchema.array() } },
      description: "List notification channels",
    },
    ...notFoundResponse,
    ...unauthorized,
  },
});

const createChannelRoute = createRoute({
  method: "post",
  tags: ["Notifications"],
  summary: "Create a notification channel",
  path: "/api/v1/projects/{slug}/notification-channels",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: notificationChannelCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: notificationChannelSchema } },
      description: "Created notification channel",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Bad request",
    },
    ...notFoundResponse,
  },
});

const deleteChannelRoute = createRoute({
  method: "delete",
  tags: ["Notifications"],
  summary: "Delete a notification channel",
  path: "/api/v1/projects/{slug}/notification-channels/{channelId}",
  request: { params: z.object({ slug: z.string(), channelId: z.string() }) },
  responses: {
    204: { description: "Deleted notification channel" },
    ...notFoundResponse,
  },
});

const retryChannelRoute = createRoute({
  method: "post",
  tags: ["Notifications"],
  summary: "Retry a git channel's current state",
  description:
    "Asks again for the state of the project's open builds on this git channel only. " +
    "Nothing is sent to chat, email or webhooks. Answers 409 while no public URL is confirmed, " +
    "and 503 when the open builds could not be looked up.",
  path: "/api/v1/projects/{slug}/notification-channels/{channelId}/retry",
  request: { params: z.object({ slug: z.string(), channelId: z.string() }) },
  responses: {
    202: {
      content: { "application/json": { schema: z.object({ asked: z.number().int() }) } },
      description: "Builds asked again",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Not a git channel",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "The channel is disabled, or notifications are paused until a public URL is confirmed",
    },
    503: {
      content: { "application/json": { schema: errorSchema } },
      description: "The open builds could not be looked up; try again",
    },
    ...notFoundResponse,
    ...unauthorized,
  },
});

/** Register the project notification-channel list, create, retry and delete endpoints. */
export function registerNotificationChannels(app: ShelfRouter): void {
  app.openapi(listChannelsRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const rows = await notificationChannelModel().list(project.id);
    return c.json(rows.map((row) => toPublic(row)));
  });

  app.openapi(createChannelRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    const valid = NotificationChannelModel.validateInput(
      getStore().notifiers,
      body.provider,
      body.config,
      { projectId: project.id, hasSecret: body.secret !== undefined },
    );
    if (!valid.ok) {
      return c.json(errorBody(valid.message), 400);
    }
    const row = await notificationChannelModel().create({ projectId: project.id, ...body });
    return c.json(toPublic(row), 201);
  });

  app.openapi(retryChannelRoute, async (c) => {
    const { slug, channelId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const result = await retryChannelState(project, channelId);
    if (!result.ok && result.status === 404) {
      notFound(result.message);
    }
    if (result.ok) {
      return c.json({ asked: result.asked }, 202);
    }
    if (result.status === 503) {
      return c.json(errorBody(result.message), 503);
    }
    return c.json(errorBody(result.message), result.status === 409 ? 409 : 400);
  });

  app.openapi(deleteChannelRoute, async (c) => {
    const { slug, channelId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const model = notificationChannelModel();
    const existing = await model.get(channelId);
    if (existing?.projectId !== project.id) {
      notFound("Notification channel not found");
    }
    await model.remove(channelId);
    return c.body(null, 204);
  });
}

const listSystemRoute = createRoute({
  method: "get",
  tags: ["Notifications"],
  summary: "List site-wide channels",
  path: "/api/v1/admin/notification-channels",
  request: {},
  responses: {
    200: {
      content: { "application/json": { schema: notificationChannelSchema.array() } },
      description: "List site-wide notification channels",
    },
    ...unauthorized,
  },
});

const createSystemRoute = createRoute({
  method: "post",
  tags: ["Notifications"],
  summary: "Create a site-wide channel",
  path: "/api/v1/admin/notification-channels",
  request: {
    body: { content: { "application/json": { schema: notificationChannelCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: notificationChannelSchema } },
      description: "Created site-wide notification channel",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Bad request",
    },
    ...unauthorized,
  },
});

const deleteSystemRoute = createRoute({
  method: "delete",
  tags: ["Notifications"],
  summary: "Delete a site-wide channel",
  path: "/api/v1/admin/notification-channels/{channelId}",
  request: { params: z.object({ channelId: z.string() }) },
  responses: {
    204: { description: "Deleted site-wide notification channel" },
    ...notFoundResponse,
  },
});

/** Register the site-admin (project-less, `sys:*`) channel endpoints. */
export function registerSystemChannels(app: ShelfRouter): void {
  app.openapi(listSystemRoute, async (c) => {
    requireSiteAdmin(c);
    const rows = await notificationChannelModel().listSystem();
    return c.json(rows.map((row) => toPublic(row)));
  });

  app.openapi(createSystemRoute, async (c) => {
    requireSiteAdmin(c);
    const body = c.req.valid("json");
    const valid = NotificationChannelModel.validateInput(
      getStore().notifiers,
      body.provider,
      body.config,
      { projectId: null, hasSecret: body.secret !== undefined },
    );
    if (!valid.ok) {
      return c.json(errorBody(valid.message), 400);
    }
    const row = await notificationChannelModel().create({ projectId: null, ...body });
    return c.json(toPublic(row), 201);
  });

  app.openapi(deleteSystemRoute, async (c) => {
    requireSiteAdmin(c);
    const { channelId } = c.req.valid("param");
    const model = notificationChannelModel();
    const existing = await model.get(channelId);
    if (existing?.projectId !== null) {
      notFound("Notification channel not found");
    }
    await model.remove(channelId);
    return c.body(null, 204);
  });
}
