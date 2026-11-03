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

/** Where a linked design stands against its component's approved baseline. */
export type DesignDrift = "deleted" | "stale" | "current" | "unknown";

/**
 * Classify a cached design node: `deleted` (the node no longer exists), `stale` (changed after the
 * baseline was approved), `current`, or `unknown` (nothing cached, the provider refused, there is no baseline
 * or no readable modification time to compare, so the state cannot be told). Reads only what was stored; never calls a provider.
 */
export function designDrift(
  node: Pick<DesignNode, "state" | "lastModified"> | null | undefined,
  baselineVersion: string | null | undefined,
): DesignDrift {
  if (node?.state === "deleted") return "deleted";
  if (isDesignStale(node, baselineVersion)) return "stale";
  const modified = node?.lastModified ? Date.parse(node.lastModified) : Number.NaN;
  return node?.state === "ok" && baselineVersion && Number.isFinite(modified)
    ? "current"
    : "unknown";
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
