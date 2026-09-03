/* oxlint-disable max-statements */
import type { Octokit } from "@octokit/rest";
import type { CheckStatus } from "@storyshelf/core";
import { describeStatus } from "@storyshelf/core/adapter/git-host/helpers";

import { mapStatus } from "./mapper.ts";

import type { Logger } from "@storyshelf/core/types";

export async function postCommitStatus(opts: {
  octokit: Octokit;
  owner: string;
  repo: string;
  context: string;
  gitSha: string;
  status: CheckStatus;
  url: string;
  logger?: Logger;
}): Promise<void> {
  const ghContext = `storyshelf/${opts.context}`;
  const state = mapStatus(opts.status);
  opts.logger?.debug({ context: ghContext, sha: opts.gitSha, state, url: opts.url }, "posting commit status");
  try {
    await opts.octokit.repos.createCommitStatus({
      owner: opts.owner,
      repo: opts.repo,
      sha: opts.gitSha,
      state,
      context: ghContext,
      target_url: opts.url,
      description: describeStatus(opts.status),
    });
    opts.logger?.info({ context: ghContext, sha: opts.gitSha, state }, "commit status posted");
  } catch (error) {
    opts.logger?.error({ err: error, context: ghContext, sha: opts.gitSha }, "failed to post commit status");
    throw error;
  }
}
