import { describe, expect, it } from "vite-plus/test";
import { publishedCacheControl, type PublishedFreshness } from "./published-access.ts";

const FRESHNESS: PublishedFreshness[] = ["immutable", "minute", "hour", "page"];

describe("publishedCacheControl", () => {
  it.each([
    ["immutable", "public, max-age=31536000, immutable"],
    ["minute", "public, max-age=60"],
    ["hour", "public, max-age=3600"],
    ["page", "public, no-cache"],
  ] as const)("keeps a public answer shared for %s", (freshness, header) => {
    expect(publishedCacheControl("public", freshness)).toBe(header);
  });

  it.each([
    ["immutable", "private, max-age=31536000, immutable"],
    ["minute", "private, max-age=60"],
    ["hour", "private, max-age=3600"],
    ["page", "private, no-cache"],
  ] as const)("makes a session answer private for %s", (freshness, header) => {
    expect(publishedCacheControl("session", freshness)).toBe(header);
  });

  it.each(FRESHNESS)("never answers a session or token access as public (%s)", (freshness) => {
    expect(publishedCacheControl("session", freshness)).not.toMatch(/public|s-maxage/u);
    expect(publishedCacheControl("token", freshness)).toMatch(/^private,/u);
  });
});
