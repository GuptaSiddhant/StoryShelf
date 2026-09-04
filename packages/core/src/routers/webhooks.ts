import { createRoute, z } from "@hono/zod-openapi";
import type { ShelfApp } from "../index.tsx";
import { WebhookModel } from "../models/webhook.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { randomToken } from "../utils/hash.ts";
import { resolveAuthorizedProject, notFound } from "./helpers.ts";
import {
  notFound as notFoundResponse,
  unauthorized,
  webhookCreatedSchema,
  webhookCreateSchema,
  webhookPublicSchema,
} from "./schemas.ts";

const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

const listWebhooksRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/webhooks",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: webhookPublicSchema.array() } },
      description: "List webhooks",
    },
    ...notFoundResponse,
    ...unauthorized,
  },
});

const createWebhookRoute = createRoute({
  method: "post",
  path: "/api/v1/projects/{slug}/webhooks",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: webhookCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: webhookCreatedSchema } },
      description: "Created webhook",
    },
    ...notFoundResponse,
  },
});

const deleteWebhookRoute = createRoute({
  method: "delete",
  path: "/api/v1/projects/{slug}/webhooks/{webhookId}",
  request: { params: z.object({ slug: z.string(), webhookId: z.string() }) },
  responses: {
    204: { description: "Deleted webhook" },
    ...notFoundResponse,
  },
});

/** Register the project webhook list, create, and delete endpoints. */
export function registerWebhooks(app: ShelfApp): void {
  app.openapi(listWebhooksRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const webhooks = await new WebhookModel(getStore().db).list(project.id);
    return c.json(
      webhooks.map((webhook) => ({
        id: webhook.id,
        url: webhook.url,
        events: WebhookModel.eventsOf(webhook),
      })),
    );
  });

  app.openapi(createWebhookRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    const secret = randomToken("whsec_").value;
    const webhook = await new WebhookModel(getStore().db).create(project.id, { ...body, secret });
    return c.json({ id: webhook.id, url: webhook.url, events: body.events ?? [], secret }, 201);
  });

  app.openapi(deleteWebhookRoute, async (c) => {
    const { slug, webhookId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const webhook = await new WebhookModel(getStore().db).get(project.id, webhookId);
    if (!webhook) {
      notFound("Webhook not found");
    }
    await new WebhookModel(getStore().db).remove(project.id, webhook.id);
    return c.body(null, 204);
  });
}
