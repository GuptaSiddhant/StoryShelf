/* oxlint-disable max-statements */
import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { githubHeaders, repoPath } from "./api.ts";
import { findPrNumber } from "./pr.ts";

interface PullSummary {
  merge_commit_sha: string | null;
  head: { sha: string };
  merged_at: string | null;
}

interface PullDetail {
  merged: boolean;
}

/** Check whether the pull request for a commit SHA has been merged. */
export async function checkIsMerged(opts: {
  token: string;
  owner: string;
  repo: string;
  sha: string;
  branch: string;
  logger?: Logger;
}): Promise<boolean> {
  try {
    const prNumber = await findPrNumber({
      token: opts.token,
      owner: opts.owner,
      repo: opts.repo,
      sha: opts.sha,
    });
    if (prNumber === undefined) {
      const query = new URLSearchParams({
        head: `${opts.owner}:${opts.branch}`,
        state: "closed",
        per_page: "5",
      });
      const pulls = await httpJson<PullSummary[]>(
        `${repoPath(opts.owner, opts.repo, "/pulls")}?${query.toString()}`,
        { headers: githubHeaders(opts.token), logger: opts.logger },
      );
      const pr = pulls.find(
        (pull) => pull.merge_commit_sha === opts.sha || pull.head.sha === opts.sha,
      );
      return pr?.merged_at != null; // oxlint-disable-line eslint/eqeqeq, eslint/no-eq-null
    }
    const pr = await httpJson<PullDetail>(repoPath(opts.owner, opts.repo, `/pulls/${prNumber}`), {
      headers: githubHeaders(opts.token),
      logger: opts.logger,
    });
    return pr.merged;
  } catch (error) {
    opts.logger?.debug(
      { err: error, sha: opts.sha, branch: opts.branch },
      "isMerged check failed, not skipping",
    );
    return false;
  }
}
