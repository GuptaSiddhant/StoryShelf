import { join, normalize, sep } from "node:path";

/** Whether a path segment is safe (no traversal). */
export function isSafeSegment(segment: string): boolean {
  return (
    segment !== ".." &&
    !segment.startsWith("/") &&
    !segment.includes("\\") &&
    !segment.includes("..")
  );
}

/** Whether joining root with candidate stays inside root (no traversal). */
export function isPathSafe(root: string, candidate: string): boolean {
  const normalizedRoot = normalize(root);
  const normalizedCandidate = normalize(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + sep) ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

/** Check if a path built from root + entry would escape root (for zip extraction). */
export function isBlockedTarget(root: string, entryPath: string): boolean {
  const target = normalize(join(root, entryPath));
  return target !== root && !target.startsWith(normalize(root) + sep);
}
