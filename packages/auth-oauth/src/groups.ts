import type { AuthUser } from "@storyshelf/core/adapter/auth";
import type { OAuthAuthOptions } from "./types.ts";

interface UserInfoResponse {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
}

/** Throw when the provider replaced group claims with an overage pointer. */
function assertNoGroupOverage(record: Record<string, unknown>): void {
  if (typeof record["_claim_names"] === "object" && record["_claim_names"] !== null) {
    throw new Error(
      "Identity provider omitted group claims (overage). Restrict the groups emitted for this app or query the provider directory directly.",
    );
  }
}

/** Append deduped string values from one claim. */
function collectClaimGroups(record: Record<string, unknown>, claim: string, into: string[]): void {
  const raw = record[claim];
  if (!Array.isArray(raw)) {
    return;
  }
  for (const value of raw) {
    if (typeof value === "string" && !into.includes(value)) {
      into.push(value);
    }
  }
}

/** Extract group memberships from the configured claims (deduped, order kept). */
export function extractGroups(info: UserInfoResponse, claimNames: string[]): string[] {
  const record = info as Record<string, unknown>;
  assertNoGroupOverage(record);
  const groups: string[] = [];
  for (const claim of claimNames) {
    collectClaimGroups(record, claim, groups);
  }
  return groups;
}

/** Resolve the site role from group membership (exact match). */
export function roleForGroups(groups: string[], options: OAuthAuthOptions): AuthUser["role"] {
  const adminGroups = options.adminGroups ?? [];
  if (groups.some((group) => adminGroups.includes(group))) {
    return "admin";
  }
  const viewerGroups = options.viewerGroups ?? [];
  if (groups.some((group) => viewerGroups.includes(group))) {
    return "viewer";
  }
  return "member";
}
