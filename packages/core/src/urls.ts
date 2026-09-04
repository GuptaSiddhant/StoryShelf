/** Type-safe URL builder for project pages and published Storybooks. */
export interface UrlBuilder {
  projectsList(): string;
  project(slug: string): string;
  buildsList(slug: string): string;
  build(slug: string, buildId: string): string;
  labels(slug: string): string;
  label(slug: string, key: string, value: string): string;
  storybook(slug: string): string;
  storybookLabel(slug: string, key: string, value: string): string;
  storybookBuild(slug: string, buildId: string): string;
  settings(slug: string): string;
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
    projectsList: () => root,
    project: (slug) => `${root}/projects/${slug}`,
    buildsList: (slug) => `${root}/projects/${slug}/builds`,
    build: (slug, buildId) => `${root}/projects/${slug}/builds/${buildId}`,
    labels: (slug) => `${root}/projects/${slug}/labels`,
    label: (slug, key, value) =>
      `${root}/projects/${slug}/labels/${encodeURIComponent(key)}/${encodeURI(value)}`,
    storybook: (slug) =>
      publishedBaseDomain
        ? `https://${slug}.${publishedBaseDomain}`
        : `${root}/projects/${slug}/storybook`,
    storybookLabel: (slug, key, value) =>
      `${root}/projects/${slug}/storybook/${encodeURIComponent(key)}/${encodeURI(value)}`,
    storybookBuild: (slug, buildId) =>
      publishedBaseDomain
        ? `https://${buildId}.${slug}.${publishedBaseDomain}`
        : `${root}/projects/${slug}/storybook/build/${buildId}`,
    settings: (slug) => `${root}/projects/${slug}/settings`,
  };
}
