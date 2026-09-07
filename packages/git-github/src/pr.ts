import { httpJson } from "@storyshelf/core/utils";
import { githubHeaders, repoPath } from "./api.ts";

interface AssociatedPull {
  number?: unknown;
}

/** Find the pull request number associated with a commit SHA, if any. */
export async function findPrNumber(opts: {
  token: string;
  owner: string;
  repo: string;
  sha: string;
}): Promise<number | undefined> {
  try {
    const pulls = await httpJson<AssociatedPull[]>(
      repoPath(opts.owner, opts.repo, `/commits/${encodeURIComponent(opts.sha)}/pulls`),
      { headers: githubHeaders(opts.token) },
    );
    const [pr] = pulls;
    if (pr && typeof pr.number === "number") {
      return pr.number;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
