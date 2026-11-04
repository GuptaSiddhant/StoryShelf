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
/**
 * Path segment for a mode on a given engine. Chromium keeps the bare mode key
 * so pre-multi-browser objects stay addressable; other engines get `~browser`.
 */
export function modeSegment(viewport: string, browser?: string): string {
  return browser && browser !== "chromium" ? `${viewport}~${browser}` : viewport;
}

/** Storage path for a captured snapshot screenshot. */
export function screenshotPath(
  projectId: string,
  buildId: string,
  storyId: string,
  viewport: string,
  browser?: string,
): string {
  const segment = modeSegment(viewport, browser);
  assertSegments([projectId, buildId, storyId, segment]);
  return `${projectId}/builds/${buildId}/screenshots/${storyId}/${segment}.png`;
}

/** Storage prefix of a project's content-addressed screenshots. */
export function contentDir(projectId: string): string {
  assertSegments([projectId]);
  return `${projectId}/content`;
}

/** Storage path of a screenshot stored by the SHA-256 of its bytes (shared by builds and baselines). */
export function contentPath(projectId: string, hash: string): string {
  assertSegments([projectId, hash]);
  return `${contentDir(projectId)}/${hash}.png`;
}

/** Whether `path` is one of `projectId`'s content-addressed screenshots. */
export function isContentPath(projectId: string, path: string): boolean {
  return path.startsWith(`${contentDir(projectId)}/`) && path.endsWith(".png");
}

/** Storage path for a snapshot diff overlay image. */
export function diffPath(
  projectId: string,
  buildId: string,
  storyId: string,
  viewport: string,
  browser?: string,
): string {
  const segment = modeSegment(viewport, browser);
  assertSegments([projectId, buildId, storyId, segment]);
  return `${projectId}/builds/${buildId}/diffs/${storyId}/${segment}.png`;
}

/** Storage path for a cached design node render (overwritten in place when the file version moves). */
export function designRenderPath(
  projectId: string,
  provider: string,
  fileKey: string,
  nodeId: string,
  viewerId = "",
): string {
  const node = nodeId.replaceAll(":", "-");
  assertSegments([projectId, provider, fileKey, node, ...(viewerId ? [viewerId] : [])]);
  const owner = viewerId ? `user-${viewerId}/` : "";
  return `${projectId}/design/${provider}/${owner}${fileKey}/${node}.png`;
}

/** Storage path for a branch baseline screenshot. */
export function baselinePath(
  projectId: string,
  branch: string,
  storyId: string,
  viewport: string,
  browser?: string,
): string {
  const segment = modeSegment(viewport, browser);
  assertSegments([projectId, branch, storyId, segment]);
  return `${projectId}/baselines/${branch}/${storyId}/${segment}.png`;
}

/** Storage prefix for an extracted published Storybook. */
export function storybookDir(projectId: string, buildId: string): string {
  assertSegments([projectId, buildId]);
  return `${projectId}/builds/${buildId}/storybook`;
}

/** The only shape of a content hash: the lowercase SHA-256 hex digest the CLI and the server compute. */
export const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/u;

/** Whether `hash` is a lowercase SHA-256 hex digest. */
export function isContentHash(hash: string): boolean {
  return CONTENT_HASH_PATTERN.test(hash);
}

/**
 * Storage key of a shared published-Storybook blob. The one place that builds `content/…`: a hash
 * from a client, a manifest or a row is checked here as well as at the API boundary, so a value like
 * `../<project>/…` can never name another project's files. The value is not echoed in the error.
 */
export function contentKey(hash: string): string {
  if (!isContentHash(hash)) throw new Error("Invalid content hash");
  return `content/${hash}`;
}

/** Disposable gzip representation of a content-addressed published file. */
export function publishedGzipPath(hash: string): string {
  if (!isContentHash(hash)) throw new Error("Invalid published content hash");
  return `derived/published-gzip/${hash}.gz`;
}

/** Storage path for an uploaded Storybook zip. */
export function storybookZipPath(projectId: string, buildId: string): string {
  assertSegments([projectId, buildId]);
  return `${projectId}/builds/${buildId}/storybook.zip`;
}

/** Storage path of a build's persisted catalog (ADR 0006, decision 9), next to its `storybook/` statics. */
export function catalogPath(projectId: string, buildId: string): string {
  assertSegments([projectId, buildId]);
  return `${projectId}/builds/${buildId}/catalog.json`;
}
