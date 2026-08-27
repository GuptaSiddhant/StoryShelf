/** Builds type-safe UI URLs for the StoryShelf web interface. */
export interface UrlBuilder {
  /** URL for the projects list page. */
  projectsList(): string;
  /** URL for a single project's page. */
  project(slug: string): string;
  /** URL for a project's builds list page. */
  buildsList(slug: string): string;
  /** URL for a single build's page. */
  build(slug: string, buildId: string): string;
  /** URL for a project's labels page. */
  labels(slug: string): string;
  /** URL for a single label's page. */
  label(slug: string, key: string, value: string): string;
  /** URL for a project's published Storybook. */
  storybook(slug: string): string;
  /** URL for a labeled variant of a project's published Storybook. */
  storybookLabel(slug: string, key: string, value: string): string;
  /** URL for a specific build's published Storybook. */
  storybookBuild(slug: string, buildId: string): string;
  /** URL for a project's settings page. */
  settings(slug: string): string;
}

/**
 * Create a UrlBuilder rooted at the given base URL.
 *
 * @param baseUrl - Root URL of the web interface.
 * @param publishedBaseDomain - Optional domain for published Storybook URLs.
 * @returns A UrlBuilder instance.
 */
export function createUrlBuilder(baseUrl: string, publishedBaseDomain?: string): UrlBuilder {
  const root = baseUrl.replace(/\/+$/u, "");

  return {
    projectsList: () => root,
    project: (slug) => `${root}/projects/${slug}`,
    buildsList: (slug) => `${root}/projects/${slug}/builds`,
    build: (slug, buildId) => `${root}/projects/${slug}/builds/${buildId}`,
    labels: (slug) => `${root}/projects/${slug}/labels`,
    label: (slug, key, value) => `${root}/projects/${slug}/labels/${encodeURIComponent(key)}/${encodeURI(value)}`,
    storybook: (slug) => (publishedBaseDomain ? `https://${slug}.${publishedBaseDomain}` : `${root}/projects/${slug}/storybook`),
    storybookLabel: (slug, key, value) => `${root}/projects/${slug}/storybook/${encodeURIComponent(key)}/${encodeURI(value)}`,
    storybookBuild: (slug, buildId) =>
      publishedBaseDomain ? `https://${buildId}.${slug}.${publishedBaseDomain}` : `${root}/projects/${slug}/storybook/build/${buildId}`,
    settings: (slug) => `${root}/projects/${slug}/settings`,
  };
}
