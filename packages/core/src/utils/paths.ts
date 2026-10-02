/** Storage path builders. Every segment is validated — a third-party
 * capture runner echoing `story.id = "../../x"` must fail here, not in an
 * adapter with its own key-jailing quirks. */
import { isSafeSegment } from "./path-security.ts";

/** Throw when any key segment could escape its storage prefix. */
function assertSegments(segments: string[]): void {
  const bad = segments.filter((segment) => !isSafeSegment(segment) || segment.length === 0);
  if (bad.length > 0) {
    throw new Error(`Unsafe storage path segment: ${bad.join(",")}`);
  }
}
/** Storage path for a captured snapshot screenshot. */
export function screenshotPath(
  projectId: string,
  buildId: string,
  storyId: string,
  viewport: string,
): string {
  assertSegments([projectId, buildId, storyId, viewport]);
  return `${projectId}/builds/${buildId}/screenshots/${storyId}/${viewport}.png`;
}

/** Storage path for a snapshot diff overlay image. */
export function diffPath(
  projectId: string,
  buildId: string,
  storyId: string,
  viewport: string,
): string {
  assertSegments([projectId, buildId, storyId, viewport]);
  return `${projectId}/builds/${buildId}/diffs/${storyId}/${viewport}.png`;
}

/** Storage path for a branch baseline screenshot. */
export function baselinePath(
  projectId: string,
  branch: string,
  storyId: string,
  viewport: string,
): string {
  assertSegments([projectId, branch, storyId, viewport]);
  return `${projectId}/baselines/${branch}/${storyId}/${viewport}.png`;
}

/** Storage prefix for an extracted published Storybook. */
export function storybookDir(projectId: string, buildId: string): string {
  assertSegments([projectId, buildId]);
  return `${projectId}/builds/${buildId}/storybook`;
}

/** Storage path for an uploaded Storybook zip. */
export function storybookZipPath(projectId: string, buildId: string): string {
  assertSegments([projectId, buildId]);
  return `${projectId}/builds/${buildId}/storybook.zip`;
}
