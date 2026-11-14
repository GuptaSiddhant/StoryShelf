/** Where the addon may run (ADR 0042, decision 1 and the 2026-11-11 amendment) and where it links to. */

/** The project and build a published Storybook belongs to. */
export interface BuildLocation {
  slug: string;
  buildId: string;
}

const BUILD_PATH =
  /^\/projects\/(?<slug>[\w.~-]+)\/storybook\/build\/(?<buildId>[\w.~-]+)(?:\/|$)/u;

/**
 * The project and build in a pathname of the canonical path-based URL on the app origin. Any other
 * shape (a short link, a subdomain, a local `storybook dev`) answers null: the addon stays inert.
 */
export function buildLocationOf(pathname: string): BuildLocation | null {
  const groups = BUILD_PATH.exec(pathname)?.groups;
  const slug = groups?.["slug"];
  const buildId = groups?.["buildId"];
  return slug !== undefined && buildId !== undefined ? { slug, buildId } : null;
}

/** True for the opaque origin of a sandboxed page, where the addon does nothing. */
export function isOpaqueOrigin(origin: string): boolean {
  return origin === "null";
}

/**
 * The review link: the server's relative path resolved against the page's own origin. Anything that
 * leaves that origin (an absolute or protocol-relative link) is refused.
 */
export function reviewUrlOf(reviewPath: string, origin: string): string | null {
  if (!reviewPath.startsWith("/") || reviewPath.startsWith("//")) return null;
  const url = new URL(reviewPath, origin);
  return url.origin === origin ? url.href : null;
}
