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

  it("states the signed Storybook URL's path and lifetime bounds the code enforces", async () => {
    const {
      DEFAULT_STORYBOOK_URL_TTL,
      MAX_STORYBOOK_URL_TTL,
      MIN_STORYBOOK_URL_TTL_OVERRIDE,
      STORYBOOK_TOKEN_PREFIX,
    } = await import("@storyshelf/core/utils");
    const guide = await readFile(GUIDE, "utf8");
    expect(guide).toContain("## How the browser reaches the Storybook");
    expect(guide).toContain("### Signed Storybook URLs");
    expect(guide).toContain(`at least ${DEFAULT_STORYBOOK_URL_TTL / 3600} hours`);
    expect(guide).toContain(`at most ${MAX_STORYBOOK_URL_TTL / 3600} hours`);
    expect(guide).toContain(`${STORYBOOK_TOKEN_PREFIX}<token>/`);
    expect(guide).toContain(`from ${MIN_STORYBOOK_URL_TTL_OVERRIDE} to ${MAX_STORYBOOK_URL_TTL}`);
    expect(guide).toContain(`${MAX_STORYBOOK_URL_TTL / 3600} hours is refused`);
  });
});
