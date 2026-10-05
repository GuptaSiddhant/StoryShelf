import { createRoute, z } from "@hono/zod-openapi";
import { NotificationChannelModel } from "@storyshelf/core/models";
import type { NotificationChannelRow } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import type { ShelfRouter } from "../app-types.ts";
import { credentialKeys } from "../credential-keys.ts";
import { getStore } from "../store.ts";
import { notFound, requireSiteAdmin, resolveAuthorizedProject } from "./helpers.ts";
import {
  notFound as notFoundResponse,
  notificationChannelCreateSchema,
  notificationChannelSchema,
  unauthorized,
} from "./schemas.ts";
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Validate channel input against the provider descriptor. */
function validateChannelInput(
  provider: string,
  config: unknown,
): { ok: true } | { ok: false; message: string } {
  const descriptor = getStore().notifiers.find((candidate) => candidate.metadata.kind === provider);
  if (!descriptor) {
    return { ok: false, message: `Unknown provider: ${provider}` };
  }
  const parsed = descriptor.metadata.schema.safeParse(config);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.message };
  }
  return { ok: true };
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
      content: { "application/json": { schema: z.object({ message: z.string() }) } },
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

/** Register the project notification-channel list, create, and delete endpoints. */
export function registerNotificationChannels(app: ShelfRouter): void {
  app.openapi(listChannelsRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const rows = await new NotificationChannelModel(
      getStore().db,
      undefined,
      credentialKeys(getStore().config),
    ).list(project.id);
    return c.json(rows.map((row) => toPublic(row)));
  });

  app.openapi(createChannelRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    const valid = validateChannelInput(body.provider, body.config);
    if (!valid.ok) {
      return c.json({ message: valid.message }, 400);
    }
    const row = await new NotificationChannelModel(
      getStore().db,
      undefined,
      credentialKeys(getStore().config),
    ).create({ projectId: project.id, ...body });
    return c.json(toPublic(row), 201);
  });

  app.openapi(deleteChannelRoute, async (c) => {
    const { slug, channelId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const model = new NotificationChannelModel(
      getStore().db,
      undefined,
      credentialKeys(getStore().config),
    );
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
      content: { "application/json": { schema: z.object({ message: z.string() }) } },
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
    const rows = await new NotificationChannelModel(
      getStore().db,
      undefined,
      credentialKeys(getStore().config),
    ).listSystem();
    return c.json(rows.map((row) => toPublic(row)));
  });

  app.openapi(createSystemRoute, async (c) => {
    requireSiteAdmin(c);
    const body = c.req.valid("json");
    const valid = validateChannelInput(body.provider, body.config);
    if (!valid.ok) {
      return c.json({ message: valid.message }, 400);
    }
    const row = await new NotificationChannelModel(
      getStore().db,
      undefined,
      credentialKeys(getStore().config),
    ).create({ projectId: null, ...body });
    return c.json(toPublic(row), 201);
  });

  app.openapi(deleteSystemRoute, async (c) => {
    requireSiteAdmin(c);
    const { channelId } = c.req.valid("param");
    const model = new NotificationChannelModel(
      getStore().db,
      undefined,
      credentialKeys(getStore().config),
    );
    const existing = await model.get(channelId);
    if (existing?.projectId !== null) {
      notFound("Notification channel not found");
    }
    await model.remove(channelId);
    return c.body(null, 204);
  });
}
