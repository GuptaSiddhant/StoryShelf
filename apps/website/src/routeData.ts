import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

/** Pages with no Markdown copy: the home page, the 404 page and the generated references. */
export function hasMarkdownCopy(path: string): boolean {
  if (path === "/" || path.startsWith("/404")) return false;
  return !path.startsWith("/api") && !path.startsWith("/reference");
}

/** Points every page's `<head>` at its Markdown copy (scripts/markdown-export.mjs writes it). */
export const onRequest = defineRouteMiddleware((context) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/u, "");
  const { pathname } = context.url;
  if (!hasMarkdownCopy(pathname.slice(base.length))) return;
  const folder = pathname.endsWith("/") ? pathname : `${pathname}/`;
  context.locals.starlightRoute.head.push({
    tag: "link",
    attrs: { rel: "alternate", type: "text/markdown", href: `${folder}index.md` },
  });
});
