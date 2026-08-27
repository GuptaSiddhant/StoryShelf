/**
 * Build the storage path for a captured screenshot.
 *
 * @param projectId - Project ID.
 * @param buildId - Build ID.
 * @param storyId - Story ID.
 * @param viewport - Viewport name.
 * @returns The storage path for the screenshot.
 */
export function screenshotPath(projectId: string, buildId: string, storyId: string, viewport: string): string {
  return `${projectId}/builds/${buildId}/screenshots/${storyId}/${viewport}.png`;
}

/**
 * Build the storage path for a diff overlay image.
 *
 * @param projectId - Project ID.
 * @param buildId - Build ID.
 * @param storyId - Story ID.
 * @param viewport - Viewport name.
 * @returns The storage path for the diff image.
 */
export function diffPath(projectId: string, buildId: string, storyId: string, viewport: string): string {
  return `${projectId}/builds/${buildId}/diffs/${storyId}/${viewport}.png`;
}

/**
 * Build the storage path for a baseline screenshot.
 *
 * @param projectId - Project ID.
 * @param branch - Git branch the baseline belongs to.
 * @param storyId - Story ID.
 * @param viewport - Viewport name.
 * @returns The storage path for the baseline.
 */
export function baselinePath(projectId: string, branch: string, storyId: string, viewport: string): string {
  return `${projectId}/baselines/${branch}/${storyId}/${viewport}.png`;
}

/**
 * Build the storage path for an extracted Storybook directory.
 *
 * @param projectId - Project ID.
 * @param buildId - Build ID.
 * @returns The storage path for the Storybook directory.
 */
export function storybookDir(projectId: string, buildId: string): string {
  return `${projectId}/builds/${buildId}/storybook`;
}

/**
 * Build the storage path for an uploaded Storybook archive.
 *
 * @param projectId - Project ID.
 * @param buildId - Build ID.
 * @returns The storage path for the Storybook zip.
 */
export function storybookZipPath(projectId: string, buildId: string): string {
  return `${projectId}/builds/${buildId}/storybook.zip`;
}
