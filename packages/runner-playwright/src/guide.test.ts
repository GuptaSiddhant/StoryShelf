import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { playwrightVersion } from "./version.ts";

const GUIDE = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "apps",
  "website",
  "src",
  "content",
  "docs",
  "guides",
  "remote-browsers.md",
);

/** Every `playwright@x.y.z` and `playwright:vx.y.z` the self-hosted farm guide tells operators to run. */
function pinnedVersions(guide: string): string[] {
  return [...guide.matchAll(/playwright(?:@|:v)(\d+\.\d+\.\d+)/gu)].map((match) => match[1] ?? "");
}

describe("the self-hosted farm guide", () => {
  it("pins the server to the playwright-core this runner drives browsers with", async () => {
    const versions = pinnedVersions(await readFile(GUIDE, "utf8"));
    // The image tag and the `npx playwright@` command: both must be there, and both must match.
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(new Set(versions)).toEqual(new Set([playwrightVersion()]));
  });

  it("states the fingerprint's font list size the code has", async () => {
    const { FONT_PROBE_FAMILIES } = await import("@storyshelf/core/utils");
    expect(await readFile(GUIDE, "utf8")).toContain(`list of ${FONT_PROBE_FAMILIES.length} common`);
  });
});
