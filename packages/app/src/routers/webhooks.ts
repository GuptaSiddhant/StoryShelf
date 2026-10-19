import { z } from "@hono/zod-openapi";
import { WebhookModel } from "@storyshelf/core/models";
import { randomToken } from "@storyshelf/core/utils";
import type { ShelfRouter } from "../app-types.ts";
import { credentialKeys } from "../credential-keys.ts";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject, notFound } from "./helpers.ts";
import { ADMIN_ROLES } from "./roles.ts";
import { deleteRouteDef, listRouteDef, postRouteDef } from "./route-defs.ts";
import { webhookCreatedSchema, webhookCreateSchema, webhookPublicSchema } from "./schemas.ts";

const listWebhooksRoute = listRouteDef({
  tag: "Webhooks",
  summary: "List webhooks",
  path: "/api/v1/projects/{slug}/webhooks",
  schema: webhookPublicSchema,
  description: "List webhooks",
});

const createWebhookRoute = postRouteDef({
  tag: "Webhooks",
  summary: "Create a webhook",
  path: "/api/v1/projects/{slug}/webhooks",
  body: webhookCreateSchema,
  schema: webhookCreatedSchema,
  description: "Created webhook",
});

const deleteWebhookRoute = deleteRouteDef({
  tag: "Webhooks",
  summary: "Delete a webhook",
  path: "/api/v1/projects/{slug}/webhooks/{webhookId}",
  params: { webhookId: z.string() },
  description: "Deleted webhook",
});

/** Register the project webhook list, create, and delete endpoints. */
export function registerWebhooks(app: ShelfRouter): void {
  app.openapi(listWebhooksRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const webhooks = await new WebhookModel(
      getStore().db,
      undefined,
      credentialKeys(getStore().config),
    ).list(project.id);
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
    const webhook = await new WebhookModel(
      getStore().db,
      undefined,
      credentialKeys(getStore().config),
    ).create(project.id, { ...body, secret });
    return c.json({ id: webhook.id, url: webhook.url, events: body.events ?? [], secret }, 201);
  });

  app.openapi(deleteWebhookRoute, async (c) => {
    const { slug, webhookId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const webhook = await new WebhookModel(
      getStore().db,
      undefined,
      credentialKeys(getStore().config),
    ).get(project.id, webhookId);
    if (!webhook) {
      notFound("Webhook not found");
    }
    await new WebhookModel(getStore().db, undefined, credentialKeys(getStore().config)).remove(
      project.id,
      webhook.id,
    );
    return c.body(null, 204);
  });
}
