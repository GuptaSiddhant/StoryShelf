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
import { publicMessage, requireSiteAdmin } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";

/** Register the public-origin routes of the System page. */
export function registerPublicOriginRoutes(app: ShelfRouter): void {
  app.post("/admin/public-origin/report", handleReport);
  app.post("/admin/public-origin", handleSet);
  app.post("/admin/public-origin/clear", handleClear);
}

/** What an admin is told when the origin is not theirs to set. */
const FIXED_ORIGIN_MESSAGE =
  "The public origin comes from PUBLIC_BASE_URL or the hosting platform, so there is nothing to confirm";

/** Whether the configuration or the platform answers: an origin an admin cannot confirm or replace. */
async function isFixed(): Promise<boolean> {
  const source = (await getStore().publicOrigin?.resolve())?.source;
  return source === "config" || source === "platform";
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
  if (!authEnabled || publicOrigin === undefined || (await isFixed())) {
    return c.body(null, 204);
  }
  const reported = await reportedOrigin(c);
  const before = await publicOrigin.stored();
  const resolvedBefore = await publicOrigin.url();
  const stored = await publicOrigin.report(reported, user?.id);
  await resumeIfChanged(resolvedBefore);
  return c.json(stored, before === null ? 201 : 200);
}

/**
 * The origin that resolves is not the one that did (`before`): it appeared after notifications were
 * paused, or an admin replaced it. Requests made while none resolved were dropped, and statuses
 * already posted link to the old origin, so ask again for the state of open builds. A mere report
 * resolves nothing and an unchanged origin changes no link, so neither asks. Chat, email and alerts
 * are never replayed (ADR 0014, decision 11).
 */
async function resumeIfChanged(before: string | undefined): Promise<void> {
  const { publicOrigin, logger } = getStore();
  const now = await publicOrigin?.url();
  if (now === undefined || now === before) {
    return;
  }
  logger.info(
    { origin: now, replaced: before !== undefined },
    "public origin changed; re-requesting the state of open builds",
  );
  requestOpenBuildStatesNow().catch(() => 0);
}

/** Store what an admin typed; the message says why not when it is no origin. */
async function storeTyped(c: Context): Promise<string> {
  if (await isFixed()) {
    return FIXED_ORIGIN_MESSAGE;
  }
  const { publicOrigin, user } = getStore();
  const origin = (await c.req.formData()).get("origin");
  try {
    const resolvedBefore = await publicOrigin?.url();
    await publicOrigin?.set(typeof origin === "string" ? origin : "", user?.id);
    await resumeIfChanged(resolvedBefore);
    return "Public origin saved";
  } catch (error) {
    return publicMessage(error, "Invalid origin");
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
