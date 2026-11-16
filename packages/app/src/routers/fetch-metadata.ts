/**
 * Fetch metadata rules (ADR 0051, decision 9). A browser states how a request came about in
 * `Sec-Fetch-*` headers that a page's script cannot set or forge. Two rules use them:
 *
 * - the grant hops (the portal's redirect to a content host and the host's exchange) answer
 *   navigations only, so a script cannot fetch a credential-bearing redirect;
 * - a state-changing request that carries a session cookie must come from the portal itself.
 *
 * A request without the headers (an old browser, a script) is not a navigation: the rule refuses it.
 */
import type { Context } from "hono";

/** Whether the request is a top-level or framed navigation: `Sec-Fetch-Mode: navigate` to a document or iframe. */
export function isNavigation(c: Context): boolean {
  const dest = c.req.header("sec-fetch-dest");
  return (
    c.req.header("sec-fetch-mode") === "navigate" && (dest === "document" || dest === "iframe")
  );
}
