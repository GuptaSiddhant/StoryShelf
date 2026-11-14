import { httpJson } from "../../utils/index.ts";
import { githubHeaders, repoPath } from "./github-api.ts";

interface AssociatedPull {
  number?: unknown;
}

/** Find the pull request number associated with a commit SHA, if any. */
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
    const [pr] = pulls;
    if (pr && typeof pr.number === "number") {
      return pr.number;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
