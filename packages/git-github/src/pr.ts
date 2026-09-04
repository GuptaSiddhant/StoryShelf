import type { Octokit } from "@octokit/rest";

/** Find the pull request number associated with a commit SHA, if any. */
export async function findPrNumber(opts: {
  octokit: Octokit;
  owner: string;
  repo: string;
  sha: string;
}): Promise<number | undefined> {
  try {
    const pulls = await opts.octokit.repos.listPullRequestsAssociatedWithCommit({
      owner: opts.owner,
      repo: opts.repo,
      commit_sha: opts.sha,
    });
    const [pr] = pulls.data;
    if (pr && typeof pr.number === "number") {
      return pr.number;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
