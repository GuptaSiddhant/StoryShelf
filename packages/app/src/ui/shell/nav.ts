import type { IconName } from "../icons/paths.ts";

/** Which nav entry is active and which project (if any) the page belongs to. */
export interface NavConfig {
  active?: string;
  projectSlug?: string;
  projectName?: string;
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
