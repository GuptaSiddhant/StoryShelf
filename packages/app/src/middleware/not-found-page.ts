import type { Context, Next } from "hono";
import { renderNotFoundPage } from "../pages/not-found.tsx";
import { safeReturnPath } from "../routers/oauth-state.ts";
import type { RenderedContent } from "../shell/document.tsx";
import { getStore } from "../store.ts";

/** Paths whose 404 stays what its route sent: API answers, assets, and token Storybook URLs. */
const PLAIN_PREFIXES = ["/api/", "/assets/", "/_s/", "/_r/", "/.well-known/", "/auth/"] as const;
const MAX_MESSAGE = 200;

function wantsPage(c: Context): boolean {
  const { path } = c.req;
  return (
    c.req.method === "GET" &&
    c.req.header("HX-Request") !== "true" &&
    (c.req.header("accept") ?? "").includes("text/html") &&
    !PLAIN_PREFIXES.some((prefix) => path.startsWith(prefix)) &&
    (c.res.headers.get("content-type") ?? "").startsWith("text/plain")
  );
}

/** What the route said was missing; Hono's own default reads "404 Not Found". */
async function messageOf(res: Response): Promise<string> {
  const text = (await res.clone().text()).trim().slice(0, MAX_MESSAGE);
  return text === "" || text === "404 Not Found" ? "Not found" : text;
}

/**
 * The 404 answer for a rendered page. For rendered JSX `c.html` hands back a promise (the collected
 * styles resolve in it) although its type only promises a `Response`, so the result is typed as
 * either and awaited by the caller.
 */
function notFoundAnswer(c: Context, page: Awaited<RenderedContent>): Response | Promise<Response> {
  return c.html(page, 404);
}

/**
 * Answer a browser's not-found with the app's own page instead of a bare line of text. Mounted
 * inside the request store so it can tell a visitor who is not signed in: they get a sign-in link
 * that brings them back to this page. The page is the same for a missing route and a hidden
 * project, so the link tells nobody which one it was (#497). Everything that is not a page
 * navigation (API calls, assets, signed URLs, HTMX requests) keeps the plain answer.
 */
export function notFoundPage() {
  return async (c: Context, next: Next): Promise<void> => {
    await next();
    if (c.res.status !== 404 || !wantsPage(c)) {
      return;
    }
    const { authEnabled, user } = getStore();
    const url = new URL(c.req.url);
    const signInHref =
      authEnabled && !user
        ? `/auth/login?return_to=${encodeURIComponent(safeReturnPath(`${url.pathname}${url.search}`, "/"))}`
        : undefined;
    const page = await renderNotFoundPage({ message: await messageOf(c.res), signInHref });
    c.res = await notFoundAnswer(c, page);
  };
}
