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
 * or either timestamp is unreadable, so the state cannot be told). Reads only what was stored; never calls a provider.
 */
export function designDrift(
  node: Pick<DesignNode, "state" | "lastModified"> | null | undefined,
  baselineVersion: string | null | undefined,
): DesignDrift {
  if (node?.state === "deleted") return "deleted";
  if (isDesignStale(node, baselineVersion)) return "stale";
  const modified = node?.lastModified ? Date.parse(node.lastModified) : Number.NaN;
  const approved = baselineVersion ? Date.parse(baselineVersion) : Number.NaN;
  return node?.state === "ok" && Number.isFinite(modified) && Number.isFinite(approved)
    ? "current"
    : "unknown";
}

/** What happened to a design after its baseline was approved. */
export type DesignChangeKind = "modified-after-approval" | "deleted";

/** A design change to tell people about, with the identity it is de-duplicated on. */
export interface DesignChange {
  change: DesignChangeKind;
  /** `<change>:<version>`: one notification per design version and kind of change. */
  key: string;
  /** The design's version when it changed (a deleted node keeps its last known one). */
  designVersion: string | null;
}

/**
 * The change worth a `design:changed` notification, or null. A deleted node always counts; a
 * modified one only when it moved after `baselineVersion` (see {@link isDesignStale}).
 */
export function designChange(
  node: Pick<DesignNode, "state" | "version" | "lastModified"> | null | undefined,
  baselineVersion: string | null | undefined,
): DesignChange | null {
  if (!node) return null;
  const designVersion = node.version ?? node.lastModified;
  if (node.state === "deleted") {
    return { change: "deleted", key: `deleted:${designVersion ?? ""}`, designVersion };
  }
  if (!isDesignStale(node, baselineVersion)) return null;
  return {
    change: "modified-after-approval",
    key: `modified-after-approval:${designVersion ?? ""}`,
    designVersion,
  };
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
