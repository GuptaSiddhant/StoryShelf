import type { IconName } from "../ui/icons/paths.ts";

/** Which nav entry is active and which project (if any) the page belongs to. */
export interface NavConfig {
  active?: string;
  projectSlug?: string;
  projectName?: string;
  /** Levels below the section, ending with the current page (e.g. a build, then "Review"). */
  trail?: NavCrumb[];
  /** `rail`: open with the sidebar collapsed unless the viewer expanded it on this kind of page. */
  sidebarDefault?: "rail";
}

/** A foldable sidebar group: a heading and its entries. */
export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

/** One breadcrumb level; the last trail item is the current page (it needs no `href`). */
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
  settings(slug: string): string;
}

/**
 * The task groups for a project: its Builds (review) and Library (browse), then Settings.
 * Jobs and Labels are reached from Settings, so each page has exactly one sidebar entry.
 */
export function projectNavGroups(urls: NavUrls, slug: string): NavGroup[] {
  return [
    {
      id: "project",
      title: "Project",
      items: [
        { key: "builds", label: "Builds", href: urls.buildsList(slug), icon: "layers" },
        { key: "library", label: "Library", href: urls.library(slug), icon: "image" },
      ],
    },
    {
      id: "settings",
      title: "Settings",
      items: [{ key: "settings", label: "Settings", href: urls.settings(slug), icon: "settings" }],
    },
  ];
}

/** Help menu entries (API reference), shown next to the theme toggle. */
export function helpNavItems(): NavItem[] {
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
 * Breadcrumbs after the project picker: the *ancestors* of the current page.
 * The page itself is named by its heading, so it is never repeated here —
 * the section plus `nav.trail` describe where the page is, and the last item
 * (the current page) is dropped. Every returned crumb links somewhere, and
 * the last one is the page's parent.
 */
export function breadcrumbs(nav: NavConfig | undefined, urls: NavUrls): NavCrumb[] {
  const section = sectionCrumb(nav, urls);
  const path = section ? [section, ...(nav?.trail ?? [])] : [...(nav?.trail ?? [])];
  return path.slice(0, -1).filter((crumb) => crumb.href !== undefined);
}

function sectionCrumb(nav: NavConfig | undefined, urls: NavUrls): NavCrumb | null {
  const slug = nav?.projectSlug;
  const table: Record<string, NavCrumb | undefined> = {
    library: slug ? { label: "Library", href: urls.library(slug) } : undefined,
    builds: slug ? { label: "Builds", href: urls.buildsList(slug) } : undefined,
    settings: slug ? { label: "Settings", href: urls.settings(slug) } : undefined,
    admin: { label: "System", href: "/admin" },
    profile: { label: "Profile", href: "/profile" },
  };
  return table[nav?.active ?? ""] ?? null;
}
