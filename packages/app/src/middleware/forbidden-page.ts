import type { Context, Next } from "hono";
import { renderForbiddenPage } from "../pages/forbidden.tsx";
import type { RenderedContent } from "../shell/document.tsx";

/** Paths whose 403 stays what its route sent: API answers, assets, and token Storybook URLs. */
const PLAIN_PREFIXES = ["/api/", "/assets/", "/_s/", "/_r/", "/.well-known/", "/auth/"] as const;
const MAX_MESSAGE = 200;
const GENERIC_MESSAGE = "Forbidden";

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

/** What the refusal said, unless it said only the status's own name. */
async function reasonOf(res: Response): Promise<string | undefined> {
  const text = (await res.clone().text()).trim().slice(0, MAX_MESSAGE);
  return text === "" || text === GENERIC_MESSAGE ? undefined : text;
}

/**
 * Answer a browser's 403 with the app's own page instead of a bare line of text, the way
 * `notFoundPage` dresses a 404. Mounted after the access gates so it sees the refusals they make.
 * API calls, assets, signed URLs, form posts and HTMX requests keep the plain answer.
 */
export function forbiddenPage() {
  return async (c: Context, next: Next): Promise<void> => {
    await next();
    if (c.res.status !== 403 || !wantsPage(c)) {
      return;
    }
    const message = await reasonOf(c.res);
    const page: RenderedContent = renderForbiddenPage(message === undefined ? {} : { message });
    c.res = await c.html(page, 403);
  };
}
