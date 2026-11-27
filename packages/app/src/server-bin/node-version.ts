import { nodeRangeOfApp } from "./manifest.ts";
import { satisfies } from "./semver-lite.ts";

/**
 * The one-line stop for a Node the server does not support, or undefined when `found` is fine. The
 * range is `@storyshelf/app`'s `engines.node` from the version manifest, so it is never copied by hand.
 */
export function nodeVersionProblem(
  found: string,
  range: string | null = nodeRangeOfApp() ?? null,
): string | undefined {
  if (range === null || satisfies(found, range)) return undefined;
  return `storyshelf-server: Node ${found} is too old; Node ${range} is required. Install a newer Node and run it again.`;
}
