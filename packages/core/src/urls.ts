/** Options of {@link UrlBuilder.component}. */
export interface ComponentUrlOptions {
  /** Show this build's states, results and comments instead of the newest build that has the file. */
  build?: string | undefined;
  /** Open this tab of the component page. */
  tab?: string | undefined;
}

/**
 * The query string of a component page: `?build=` and `?tab=` when given, else nothing. `path`
 * is the import path itself, for the one case that cannot travel in the URL path (see
 * {@link hasDotSegment}).
 */
function componentQuery(options: ComponentUrlOptions | undefined, path?: string): string {
  const params = new URLSearchParams();
  if (path !== undefined) {
    params.set("path", path);
  }
  if (options?.build) {
    params.set("build", options.build);
  }
  if (options?.tab !== undefined) {
    params.set("tab", options.tab);
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/** Type-safe URL builder for project pages and published Storybooks. */
export interface UrlBuilder {
  projectsList(): string;
  projects(): string;
  project(slug: string): string;
  projectsNew(): string;
  buildsList(slug: string): string;
  build(slug: string, buildId: string): string;
  buildDiff(slug: string, buildId: string): string;
  /** Review page of one snapshot: the build's diff page with that snapshot selected. */
  snapshot(slug: string, buildId: string, snapshotId: string): string;
  library(slug: string): string;
  /** Design coverage page: stories vs design links vs drift. */
  designCoverage(slug: string): string;
  jobs(slug: string): string;
  labels(slug: string): string;
  label(slug: string, key: string, value: string): string;
  /** Stable component page, keyed by the story file's import path; `build` selects one build, `tab` one of its tabs. */
  component(slug: string, importPath: string, options?: ComponentUrlOptions): string;
  storybook(slug: string): string;
  storybookLabel(slug: string, key: string, value: string): string;
  storybookBuild(slug: string, buildId: string): string;
  /** The project settings page on its first tab (General). */
  settings(slug: string): string;
  /** One tab of the project settings: `general`, `capture`, `review`, `access` or `insights`. */
  settingsTab(slug: string, tab: string): string;
  short(id: string): string;
}

/**
 * Create a URL builder rooted at the given base URL.
 *
 * @param baseUrl - Public root URL of the shelf server.
 * @param publishedBaseDomain - Optional wildcard domain for published Storybooks.
 * @returns The URL builder.
 */
export function createUrlBuilder(baseUrl: string, publishedBaseDomain?: string): UrlBuilder {
  const root = baseUrl.replace(/\/+$/u, "");

  return {
    projectsList: () => root || "/",
    projects: () => `${root}/projects`,
    project: (slug) => `${root}/projects/${slug}`,
    projectsNew: () => `${root}/projects/new`,
    buildsList: (slug) => `${root}/projects/${slug}/builds`,
    build: (slug, buildId) => `${root}/projects/${slug}/builds/${buildId}`,
    buildDiff: (slug, buildId) => `${root}/projects/${slug}/builds/${buildId}/diff`,
    snapshot: (slug, buildId, snapshotId) =>
      `${root}/projects/${slug}/builds/${buildId}/diff?snapshot=${encodeURIComponent(snapshotId)}`,
    library: (slug) => `${root}/projects/${slug}/library`,
    designCoverage: (slug) => `${root}/projects/${slug}/design/coverage`,
    jobs: (slug) => `${root}/projects/${slug}/jobs`,
    labels: (slug) => `${root}/projects/${slug}/labels`,
    label: (slug, key, value) => {
      const page = `${root}/projects/${slug}/labels/${encodeURIComponent(key)}/`;
      return hasDotSegment(value)
        ? `${page}?value=${encodeURIComponent(value)}`
        : `${page}${encodePath(value)}`;
    },
    component: (slug, importPath, options) => {
      const path = importPath.replace(/^(?:\.\/)+/u, "");
      const page = `${root}/projects/${slug}/components/`;
      return hasDotSegment(path)
        ? `${page}${componentQuery(options, path)}`
        : `${page}${encodePath(path)}${componentQuery(options)}`;
    },
    storybook: (slug) =>
      publishedBaseDomain
        ? `https://${slug}.${publishedBaseDomain}`
        : `${root}/projects/${slug}/storybook`,
    storybookLabel: (slug, key, value) =>
      `${root}/projects/${slug}/storybook/${encodeURIComponent(key)}/${encodePath(value)}`,
    storybookBuild: (slug, buildId) =>
      publishedBaseDomain
        ? `https://${buildId}.${slug}.${publishedBaseDomain}`
        : `${root}/projects/${slug}/storybook/build/${buildId}`,
    settings: (slug) => `${root}/projects/${slug}/settings/general`,
    settingsTab: (slug, tab) => `${root}/projects/${slug}/settings/${tab}`,
    short: (id) => `${root}/_/${id}/`,
  };
}

/**
 * Embeddable image URL check for IdP-supplied avatars: `https:` and
 * app-relative paths only, so `javascript:`/`data:` payloads fall back.
 */
export function safeImageUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Encode a value that may hold slashes (a label value, a branch, an import path) as URL path
 * segments: each segment is escaped (`?`, `#` and `%` included), the slashes stay.
 */
function encodePath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Whether a value has a path segment that is exactly `.` or `..`. A browser, and `new URL`,
 * resolve such a segment (even as `%2E%2E`) before the request, so the link would open another
 * page. These values travel in the query string of the same page instead (`?value=`, `?path=`);
 * the routes accept both forms. Every other value keeps its path form.
 */
export function hasDotSegment(value: string): boolean {
  return value.split("/").some((segment) => segment === "." || segment === "..");
}
