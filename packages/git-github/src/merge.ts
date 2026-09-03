/* oxlint-disable max-statements */
import type { Octokit } from "@octokit/rest";
import type { Logger } from "@storyshelf/core/types";

import { findPrNumber } from "./pr.ts";

export async function checkIsMerged(opts: {
  octokit: Octokit;
  owner: string;
  repo: string;
  sha: string;
  branch: string;
  logger?: Logger;
}): Promise<boolean> {
  try {
    const prNumber = await findPrNumber({
      octokit: opts.octokit,
      owner: opts.owner,
      repo: opts.repo,
      sha: opts.sha,
    });
    if (prNumber === undefined) {
      const pulls = await opts.octokit.pulls.list({
        owner: opts.owner,
        repo: opts.repo,
        head: `${opts.owner}:${opts.branch}`,
        state: "closed",
        per_page: 5,
      });
      const pr = pulls.data.find((pull) => pull.merge_commit_sha === opts.sha || pull.head.sha === opts.sha);
      return pr?.merged_at != null; // oxlint-disable-line eslint/eqeqeq, eslint/no-eq-null
    }
    const pr = await opts.octokit.pulls.get({
      owner: opts.owner,
      repo: opts.repo,
      pull_number: prNumber,
    });
    return pr.data.merged;
  } catch (error) {
    opts.logger?.debug({ err: error, sha: opts.sha, branch: opts.branch }, "isMerged check failed, not skipping");
    return false;
  }
}
