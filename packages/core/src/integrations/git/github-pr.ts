import { httpJson } from "../../utils/index.ts";
import { githubHeaders, repoPath } from "./github-api.ts";

interface AssociatedPull {
  number?: unknown;
  state?: unknown;
}

/**
 * Find the open pull request associated with a commit SHA, if any. GitHub also lists closed and
 * merged pull requests (a commit on the default branch returns the PR that merged it), and those
 * get no comment.
 */
export async function findPrNumber(opts: {
  token: string;
  owner: string;
  repo: string;
  apiUrl?: string | undefined;
  sha: string;
}): Promise<number | undefined> {
  try {
    const pulls = await httpJson<AssociatedPull[]>(
      repoPath(opts, `/commits/${encodeURIComponent(opts.sha)}/pulls`),
      { headers: githubHeaders(opts.token) },
    );
    return pulls.find((pull) => isOpenPull(pull))?.number;
  } catch {
    return undefined;
  }
}

function isOpenPull(pull: AssociatedPull): pull is { number: number; state: "open" } {
  return pull.state === "open" && typeof pull.number === "number";
}
