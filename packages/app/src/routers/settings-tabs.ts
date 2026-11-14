import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { isSettingsTab, movedSection, settingsHref } from "../pages/settings-tabs.ts";
import { notFound } from "./helpers.ts";
import { renderSettingsPage } from "./settings.handlers.ts";

/** The query string of the request, `?` included, or empty. */
function searchOf(c: Context): string {
  return new URL(c.req.url).search;
}

/**
 * The project settings pages (issue #807): one URL per tab, `/settings/<tab>`, so links and the
 * browser's Back button work. The pages that used to have a URL of their own redirect to the tab
 * that now holds them, keeping the query string and pointing at their section.
 */
export function registerSettingsTabs(app: ShelfRouter): void {
  app.get("/projects/:slug/settings", (c) =>
    c.redirect(`/projects/${c.req.param("slug")}/settings/general${searchOf(c)}`, 302),
  );
  app.get("/projects/:slug/settings/:tab", async (c) => {
    const tab = c.req.param("tab");
    const slug = c.req.param("slug");
    if (isSettingsTab(tab)) {
      const editKey = c.req.query("edit");
      // `?edit=<label key>` opens that label type's form, which belongs to the labels section.
      return c.html(
        tab === "review" && editKey
          ? await renderSettingsPage(c, "labels", { editKey })
          : await renderSettingsPage(c, tab),
      );
    }
    const moved = movedSection(tab);
    return moved ? c.redirect(settingsHref(slug, moved, searchOf(c)), 302) : notFound("Not found");
  });
}
