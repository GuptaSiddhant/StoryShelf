/** The three sidebar menus: the docs, the packages (with their TypeScript API) and the HTTP API. */
export type Section = "docs" | "packages" | "api";

/** Header and mobile-menu links, one per section. */
export const sectionLinks = (base: string): { section: Section; label: string; href: string }[] => [
  { section: "docs", label: "Docs", href: `${base}/guides/getting-started/` },
  { section: "packages", label: "Packages", href: `${base}/packages/` },
  { section: "api", label: "HTTP API", href: `${base}/api/` },
];

/** Which menu a page belongs to, from its path. */
export function sectionOf(pathname: string, base: string): Section {
  const path = pathname.slice(base.length);
  if (path.startsWith("/api")) return "api";
  if (path.startsWith("/packages") || path.startsWith("/reference")) return "packages";
  return "docs";
}
