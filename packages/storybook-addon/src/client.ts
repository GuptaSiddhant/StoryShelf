/** The addon's two reads: `GET /api/v1/health`, then `GET .../story-status`. Same origin, session cookie. */
import type { BuildLocation } from "./location.ts";
import { parseStoryStatus } from "./parse.ts";
import type { StoryStatusBody } from "./types.ts";

/** The part of `fetch` the addon uses; tests pass a fake. */
export type Fetcher = (input: string, init: { credentials: "same-origin" }) => Promise<Response>;

async function readJson(fetcher: Fetcher, url: string): Promise<unknown> {
  const response = await fetcher(url, { credentials: "same-origin" });
  return response.ok ? ((await response.json()) as unknown) : null;
}

/** True when the instance reports `testing: true`; without it the route answers 404. */
async function testingOn(fetcher: Fetcher): Promise<boolean> {
  const health = await readJson(fetcher, "/api/v1/health");
  return (
    typeof health === "object" && health !== null && "testing" in health && health.testing === true
  );
}

/**
 * The build's per-story state, or null when there is nothing to show: testing is off, the viewer
 * has no access (the server answers 404), the answer is malformed, or the request failed.
 */
export async function fetchStoryStatus(
  fetcher: Fetcher,
  location: BuildLocation,
): Promise<StoryStatusBody | null> {
  try {
    if (!(await testingOn(fetcher))) return null;
    const { slug, buildId } = location;
    return parseStoryStatus(
      await readJson(fetcher, `/api/v1/projects/${slug}/builds/${buildId}/story-status`),
    );
  } catch {
    return null;
  }
}
