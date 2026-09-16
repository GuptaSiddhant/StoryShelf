/** Storage path for a captured snapshot screenshot. */
export function screenshotPath(
  projectId: string,
  buildId: string,
  storyId: string,
  viewport: string,
): string {
  return `${projectId}/builds/${buildId}/screenshots/${storyId}/${viewport}.png`;
}

/** Storage path for a snapshot diff overlay image. */
export function diffPath(
  projectId: string,
  buildId: string,
  storyId: string,
  viewport: string,
): string {
  return `${projectId}/builds/${buildId}/diffs/${storyId}/${viewport}.png`;
}

/** Storage path for a branch baseline screenshot. */
export function baselinePath(
  projectId: string,
  branch: string,
  storyId: string,
  viewport: string,
): string {
  return `${projectId}/baselines/${branch}/${storyId}/${viewport}.png`;
}

/** Storage prefix for an extracted published Storybook. */
export function storybookDir(projectId: string, buildId: string): string {
  return `${projectId}/builds/${buildId}/storybook`;
}

/** Storage path for an uploaded Storybook zip. */
export function storybookZipPath(projectId: string, buildId: string): string {
  return `${projectId}/builds/${buildId}/storybook.zip`;
}
