import { Octokit } from "@octokit/rest";
import type { GitHostAdapter, GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { Logger } from "@storyshelf/core/logger";
import { upsertPrComment } from "./comment.ts";
import { githubConfigSchema } from "./config.ts";
import { checkIsMerged } from "./merge.ts";
import { getMetadata } from "./metadata.ts";
import { postCommitStatus } from "./status.ts";

interface GitHubStatusOptions {
  token: string;
  owner: string;
  repo: string;
  logger?: Logger;
}

function createGitHubStatusAdapter(options: GitHubStatusOptions): GitHostAdapter {
  const octokit = new Octokit({ auth: options.token });
  const logger = options.logger?.child({ component: "git-github" });

  return {
    metadata: getMetadata(),
    async setStatus(opts) {
      await postCommitStatus({
        octokit,
        owner: options.owner,
        repo: options.repo,
        context: opts.context,
        gitSha: opts.gitSha,
        status: opts.status,
        url: opts.url,
        logger,
      });
    },
    async isMerged(opts) {
      return await checkIsMerged({
        octokit,
        owner: options.owner,
        repo: options.repo,
        sha: opts.sha,
        branch: opts.branch,
        logger,
      });
    },
    async upsertComment(opts) {
      return await upsertPrComment({
        octokit,
        owner: options.owner,
        repo: options.repo,
        sha: opts.sha,
        url: opts.url,
        markdown: opts.markdown,
        prNumber: opts.prNumber,
        logger,
      });
    },
  };
}

/** GitHub commit-status provider for StoryShelf merge gates. */
export const gitHubHost: GitHostProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; token: string; logger?: Logger }): GitHostAdapter {
    const cfg = githubConfigSchema.parse(opts.config);
    return createGitHubStatusAdapter({
      token: opts.token,
      owner: cfg.owner,
      repo: cfg.repo,
      logger: opts.logger,
    });
  },
};
