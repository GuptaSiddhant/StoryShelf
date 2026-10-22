/**
 * The public origin, learnt from an admin's browser (ADR 0007, decision 6): the System page reports
 * `location.origin`, an admin confirms or replaces it, and background jobs read it from the database.
 * Site-admin and CSRF protected; with authentication off there is no admin, so nothing is learnt.
 */
import { normalizeOrigin } from "@storyshelf/core/utils";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { requestOpenBuildStatesNow } from "../git-status.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { requireSiteAdmin } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";

/** Register the public-origin routes of the System page. */
export function registerPublicOriginRoutes(app: ShelfRouter): void {
  app.post("/admin/public-origin/report", handleReport);
  app.post("/admin/public-origin", handleSet);
  app.post("/admin/public-origin/clear", handleClear);
}

/** The origin a report names, once it matches what the browser says it used; throws 400 otherwise. */
async function reportedOrigin(c: Context): Promise<string> {
  const body = (await c.req.json().catch(() => null)) as { origin?: unknown } | null;
  const reported = typeof body?.origin === "string" ? normalizeOrigin(body.origin) : undefined;
  // The browser states the origin it used itself; a report that disagrees is not one.
  if (reported === undefined || c.req.header("origin") !== reported) {
    throw new HTTPException(400, { message: "Origin does not match the request" });
  }
  return reported;
}

/** The page reports the origin it was loaded from; the first report is kept. */
async function handleReport(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  const { authEnabled, publicOrigin, user } = getStore();
  if (!authEnabled || publicOrigin === undefined) {
    return c.body(null, 204);
  }
  const reported = await reportedOrigin(c);
  const before = await publicOrigin.stored();
  const wasResolved = (await publicOrigin.url()) !== undefined;
  const stored = await publicOrigin.report(reported, user?.id);
  await resumeIfResolved(wasResolved);
  return c.json(stored, before === null ? 201 : 200);
}

/**
 * Notifications were paused and an origin now resolves (an admin confirmed one; a mere report
 * resolves nothing): re-request the state of open builds.
 */
async function resumeIfResolved(wasResolved: boolean): Promise<void> {
  if (!wasResolved && (await getStore().publicOrigin?.url()) !== undefined) {
    requestOpenBuildStatesNow().catch(() => 0);
  }
}

/** Store what an admin typed; the message says why not when it is no origin. */
async function storeTyped(c: Context): Promise<string> {
  const { publicOrigin, user } = getStore();
  const origin = (await c.req.formData()).get("origin");
  try {
    const wasResolved = (await publicOrigin?.url()) !== undefined;
    await publicOrigin?.set(typeof origin === "string" ? origin : "", user?.id);
    await resumeIfResolved(wasResolved);
    return "Public origin saved";
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid origin";
  }
}

/** An admin confirmed the detected origin or entered another. */
async function handleSet(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  const { authEnabled, publicOrigin } = getStore();
  if (!authEnabled || publicOrigin === undefined) {
    flash(
      c,
      "The public origin is learnt from an admin's browser, which needs authentication",
      "warning",
    );
    return hxRedirect(c, "/admin");
  }
  const message = await storeTyped(c);
  flash(c, message, message === "Public origin saved" ? "success" : "warning");
  return hxRedirect(c, "/admin");
}

/** An admin dropped the stored origin; the next admin visit reports a fresh one. */
async function handleClear(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  const { publicOrigin } = getStore();
  await publicOrigin?.clear();
  flash(c, "Stored public origin removed");
  return hxRedirect(c, "/admin");
}
