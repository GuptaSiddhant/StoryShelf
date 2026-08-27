import type { Hono } from "hono";
import { z } from "zod";

import { WebhookModel } from "../models/webhook.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { randomToken } from "../utils/hash.ts";
import { json, notFound, resolveAuthorizedProject, validJson } from "./helpers.ts";

const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

const createSchema = z.object({
  url: z.url(),
  events: z.array(z.string().min(1)).optional(),
});

export function registerWebhooks(app: Hono): void {
  app.get("/api/v1/projects/:slug/webhooks", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    const webhooks = await new WebhookModel(getStore().db).list(project.id);
    return json(c, webhooks.map(({ secret: _secret, ...rest }) => rest));
  });

  app.post("/api/v1/projects/:slug/webhooks", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    const body = await validJson(c, createSchema);
    const secret = randomToken("whsec_").value;
    const webhook = await new WebhookModel(getStore().db).create(project.id, { ...body, secret });
    return json(c, { id: webhook.id, url: webhook.url, events: body.events ?? [], secret }, 201);
  });

  app.delete("/api/v1/projects/:slug/webhooks/:webhookId", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug"), ...ADMIN_ROLES);
    const webhook = await new WebhookModel(getStore().db).get(project.id, c.req.param("webhookId"));
    if (!webhook) {
      notFound("Webhook not found");
    }
    await new WebhookModel(getStore().db).remove(project.id, webhook.id);
    return c.body(null, 204);
  });
}