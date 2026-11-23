/**
 * System → Git (ADR 0054): the page, the operator switch and removing a stored connection. The
 * connect flows live in `admin-git-connect.ts`, the link requests in `admin-git-links.ts`. Every
 * route is a site-admin page classed `hosting` (git delivery works with testing off), and every
 * write is under `CSRF_PATHS` (`/admin/git/*`).
 */
import {
  CONNECTION_REMOVED_REASON,
  GIT_LINK_ANY_REPOSITORY_KEY,
  GitRepositoryLinkModel,
  ManagedGitConnectionError,
  SiteSettingsModel,
} from "@storyshelf/core/models";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { gitConnectionModel, loadAdminGitData } from "../git-admin.ts";
import { renderAdminGitPage } from "../pages/admin-git.tsx";
import { getStore } from "../store.ts";
import { registerGitConnect } from "./admin-git-connect.ts";
import { registerGitLinkRequests } from "./admin-git-links.tsx";
import { flash } from "./flash.ts";
import { requireSiteAdmin } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";

/** Where System → Git lives. */
export const ADMIN_GIT_PATH = "/admin/git";

/** Register System → Git and its flows. */
export function registerAdminGit(app: ShelfRouter): void {
  app.get(ADMIN_GIT_PATH, handlePage);
  app.post(`${ADMIN_GIT_PATH}/settings`, handleSwitch);
  app.post(`${ADMIN_GIT_PATH}/connections/:id/remove`, handleRemove);
  registerGitConnect(app);
  registerGitLinkRequests(app);
}

async function handlePage(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  c.header("Cache-Control", "no-store");
  return c.html(renderAdminGitPage(await loadAdminGitData()));
}

/** The operator switch: project admins may link any repository a connection covers. */
async function handleSwitch(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  const { db, user } = getStore();
  const on = (await c.req.parseBody())["anyRepository"] === "on";
  await new SiteSettingsModel(db).set(GIT_LINK_ANY_REPOSITORY_KEY, String(on), user?.id);
  flash(
    c,
    on ? "Project admins may now link covered repositories" : "Site admins approve each link",
  );
  return hxRedirect(c, ADMIN_GIT_PATH);
}

/**
 * Remove a stored connection. Its approved links stop posting at once: they are marked broken with
 * the reason the start-up sync uses, so the project and the System page say why, and a site admin
 * reconnects them through another connection.
 */
async function handleRemove(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  const outcome = await removeConnection(c.req.param("id") ?? "");
  flash(c, outcome.message, outcome.tone);
  return hxRedirect(c, ADMIN_GIT_PATH);
}

/** Remove the connection and break its links; the message says what happened. */
async function removeConnection(
  id: string,
): Promise<{ message: string; tone: "success" | "warning" }> {
  const model = gitConnectionModel();
  const connection = await model.get(id);
  if (connection === null) {
    return { message: "That connection is already gone", tone: "warning" };
  }
  try {
    await model.remove(id);
  } catch (error) {
    if (!(error instanceof ManagedGitConnectionError)) throw error;
    return {
      message: "This connection comes from configuration; remove it there",
      tone: "warning",
    };
  }
  return {
    message: `${connection.name} removed${stoppedNote(await breakLinksOf(id))}`,
    tone: "success",
  };
}

const stoppedNote = (broken: number): string =>
  broken > 0 ? `; ${broken} link(s) stopped posting` : "";

async function breakLinksOf(connectionId: string): Promise<number> {
  const links = new GitRepositoryLinkModel(getStore().db);
  const approved = (await links.listAll("approved")).filter(
    (link) => link.connectionId === connectionId,
  );
  const results = await Promise.all(
    approved.map(async (link) => await links.markBroken(link.id, CONNECTION_REMOVED_REASON)),
  );
  return results.filter((row) => row !== null).length;
}
