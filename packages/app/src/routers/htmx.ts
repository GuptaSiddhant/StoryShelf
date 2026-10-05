import type { Context } from "hono";

/** Check whether the request came from HTMX (HX-Request header). */
export function isHxRequest(c: Context): boolean {
  return c.req.header("HX-Request") === "true";
}

/** Redirect HTMX requests via HX-Redirect and plain requests via 302. */
export function hxRedirect(c: Context, url: string): Response {
  if (isHxRequest(c)) {
    c.header("HX-Redirect", url);
    return c.body(null, 204);
  }
  return c.redirect(url, 302);
}

/** Ask HTMX to reload the current page (review forms post with `hx-target="body"`). */
export function hxRefresh(c: Context): void {
  if (isHxRequest(c)) {
    c.header("HX-Refresh", "true");
  }
}
