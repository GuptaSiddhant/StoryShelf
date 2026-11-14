import { BuildModel, TokenModel } from "@storyshelf/core/models";
import type { ShelfRouter } from "../app-types.ts";
import { GetStarted } from "../pages/get-started.tsx";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { assertRole } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { findProject } from "./settings.handlers.ts";

/** First-run card actions: issue the first token and poll for the first build. */
export function registerGetStarted(app: ShelfRouter): void {
  app.post("/projects/:slug/get-started/token", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    await assertRole(project.id, "admin");
    const store = getStore();
    const name = "CI";
    const { value } = await new TokenModel(store.db).issue(project.id, {
      name,
      userId: store.user?.id ?? null,
    });
    flash(c, "Token created — copy it now, it is shown once");
    const origin = await store.publicOrigin?.url();
    return c.html(<GetStarted project={project} origin={origin} created={{ name, value }} />);
  });

  app.get("/projects/:slug/get-started/status", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    const builds = await new BuildModel(getStore().db).list(project.id, { limit: 1 });
    if (builds.length === 0) return c.body(null, 204);
    return hxRedirect(c, `/projects/${project.slug}/builds`);
  });
}
