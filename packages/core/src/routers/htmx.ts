import type { Context } from "hono";

export function isHxRequest(c: Context): boolean {
  return c.req.header("HX-Request") === "true";
}

export function hxRedirect(c: Context, url: string): Response {
  if (isHxRequest(c)) {
    c.header("HX-Redirect", url);
    return c.body(null, 204);
  }
  return c.redirect(url, 302);
}