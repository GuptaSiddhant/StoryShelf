export function screenshotPath(projectId: string, buildId: string, storyId: string, viewport: string): string {
  return `${projectId}/builds/${buildId}/screenshots/${storyId}/${viewport}.png`;
}

export function diffPath(projectId: string, buildId: string, storyId: string, viewport: string): string {
  return `${projectId}/builds/${buildId}/diffs/${storyId}/${viewport}.png`;
}

export function baselinePath(projectId: string, branch: string, storyId: string, viewport: string): string {
  return `${projectId}/baselines/${branch}/${storyId}/${viewport}.png`;
}

export function storybookDir(projectId: string, buildId: string): string {
  return `${projectId}/builds/${buildId}/storybook`;
}

export function storybookZipPath(projectId: string, buildId: string): string {
  return `${projectId}/builds/${buildId}/storybook.zip`;
}
