/** Design cache freshness, staleness and credential-age rules (provider-neutral). */
import type { DesignNode } from "../schema/design.ts";

/** Cached metadata younger than this is served without a refetch. */
export const DESIGN_TTL_MS = 15 * 60_000;

/** True when the design changed after the baseline it is compared with was approved. */
export function isDesignStale(
  node: Pick<DesignNode, "state" | "lastModified"> | null | undefined,
  baselineVersion: string | null | undefined,
): boolean {
  if (node?.state !== "ok" || !node.lastModified || !baselineVersion) return false;
  const modified = Date.parse(node.lastModified);
  const approved = Date.parse(baselineVersion);
  return Number.isFinite(modified) && Number.isFinite(approved) && modified > approved;
}

/**
 * Days until a credential passes its provider's maximum lifetime (negative once
 * past). `issuedAt` is when the credential was set or replaced — never a status write.
 */
export function credentialDaysLeft(
  issuedAt: string,
  maxAgeDays: number,
  now: Date = new Date(),
): number {
  const ageDays = (now.getTime() - Date.parse(issuedAt)) / 86_400_000;
  return Math.ceil(maxAgeDays - ageDays);
}
