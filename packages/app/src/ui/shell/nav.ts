import type { IconName } from "../icons/paths.ts";

/** Which nav entry is active and which project (if any) the page belongs to. */
export interface NavConfig {
  active?: string;
  projectSlug?: string;
  projectName?: string;
  /** Deeper breadcrumb levels below the section (e.g. a build, then "Review"). */
  trail?: NavCrumb[];
}

/** One breadcrumb level; the last has no `href` and marks the current page. */
export interface NavCrumb {
  label: string;
  href?: string;
}

/** One sidebar entry. */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  /** Opens in a new tab (raw API output). */
  external?: boolean;
}

/** Subset of the URL builder the nav needs (keeps this module pure). */
export interface NavUrls {
  projects(): string;
  library(slug: string): string;
  buildsList(slug: string): string;
  jobs(slug: string): string;
  labels(slug: string): string;
  settings(slug: string): string;
}

/** Entries shown for the current project. */
export function projectNavItems(urls: NavUrls, slug: string): NavItem[] {
  return [
    { key: "library", label: "Library", href: urls.library(slug), icon: "image" },
    { key: "builds", label: "Builds", href: urls.buildsList(slug), icon: "layers" },
    { key: "jobs", label: "Jobs", href: urls.jobs(slug), icon: "activity" },
    { key: "labels", label: "Labels", href: urls.labels(slug), icon: "tag" },
    { key: "settings", label: "Settings", href: urls.settings(slug), icon: "settings" },
  ];
}

/** Developer entries (API reference). */
export function developerNavItems(): NavItem[] {
  return [
    { key: "api-docs", label: "API docs", href: "/api/v1/docs", icon: "book" },
    {
      key: "openapi",
      label: "OpenAPI spec",
      href: "/api/v1/openapi.json",
      icon: "code",
      external: true,
    },
  ];
}

/** Administration entries (admins only). */
export function adminNavItems(): NavItem[] {
  return [{ key: "admin", label: "System", href: "/admin", icon: "server" }];
}

/**
 * Breadcrumbs after the project picker: the active section (a link when the
 * page goes deeper) followed by the page's own `trail`. The final crumb is
 * always rendered as the current page.
 */
export function breadcrumbs(nav: NavConfig | undefined, urls: NavUrls): NavCrumb[] {
  const trail = nav?.trail ?? [];
  const section = sectionCrumb(nav, urls);
  const crumbs = section ? [section, ...trail] : [...trail];
  return crumbs.map((crumb, index) =>
    index === crumbs.length - 1 ? { label: crumb.label } : crumb,
  );
}

function sectionCrumb(nav: NavConfig | undefined, urls: NavUrls): NavCrumb | null {
  const slug = nav?.projectSlug;
  const table: Record<string, NavCrumb | undefined> = {
    library: slug ? { label: "Library", href: urls.library(slug) } : undefined,
    builds: slug ? { label: "Builds", href: urls.buildsList(slug) } : undefined,
    jobs: slug ? { label: "Jobs", href: urls.jobs(slug) } : undefined,
    labels: slug ? { label: "Labels", href: urls.labels(slug) } : undefined,
    settings: slug ? { label: "Settings", href: urls.settings(slug) } : undefined,
    admin: { label: "System", href: "/admin" },
    profile: { label: "Profile", href: "/profile" },
  };
  return table[nav?.active ?? ""] ?? null;
}
