/** Figma cache freshness, design-staleness and token-age rules. */
import type { FigmaNode } from "../schema/design.ts";

/** Cached metadata younger than this is served without a refetch. */
export const FIGMA_TTL_MS = 15 * 60_000;
/** Figma personal access tokens expire after at most 90 days. */
export const FIGMA_TOKEN_MAX_AGE_DAYS = 90;

/** True when the design changed after the baseline it is compared with was approved. */
export function isDesignStale(
  node: Pick<FigmaNode, "state" | "lastModified"> | null | undefined,
  baselineVersion: string | null | undefined,
): boolean {
  if (node?.state !== "ok" || !node.lastModified || !baselineVersion) return false;
  const modified = Date.parse(node.lastModified);
  const approved = Date.parse(baselineVersion);
  return Number.isFinite(modified) && Number.isFinite(approved) && modified > approved;
}

/**
 * Days until the project's token passes the 90-day cap (negative once past).
 * `issuedAt` is when the credential was set or replaced — never a status write.
 */
export function tokenDaysLeft(issuedAt: string, now: Date = new Date()): number {
  const ageDays = (now.getTime() - Date.parse(issuedAt)) / 86_400_000;
  return Math.ceil(FIGMA_TOKEN_MAX_AGE_DAYS - ageDays);
}
