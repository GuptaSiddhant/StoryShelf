/**
 * A git channel posted from Project → Settings → Notifications (a page from before release N+1 of
 * ADR 0054, decision 8): refused, with where git hosts went. Nothing is stored and the typed token
 * or key is never echoed back.
 */
import { GIT_CHANNELS_CLOSED } from "@storyshelf/core/models";
import type { Context } from "hono";
import { renderSettingsPage } from "./settings.handlers.ts";

/** Render the tab again with the refusal (HTTP 400). */
export async function refuseGitChannel(c: Context): Promise<Response> {
  return c.html(
    (await renderSettingsPage(c, "notifications", { globalError: GIT_CHANNELS_CLOSED })) ?? "",
    400,
  );
}
