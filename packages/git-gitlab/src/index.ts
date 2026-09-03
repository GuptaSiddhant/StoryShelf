import type { Logger } from "@storyshelf/core/types";
import type { GitHostAdapter, GitHostProvider } from "@storyshelf/core";

import { upsertMrNote } from "./comment.ts";
import { gitlabConfigSchema } from "./config.ts";
import { checkIsMerged } from "./merge.ts";
import { getMetadata } from "./metadata.ts";
import { postCommitStatus } from "./status.ts";

interface GitLabStatusOptions {
  token: string;
  owner: string;
  repo: string;
  host?: string;
  logger?: Logger;
}

function createGitLabStatusAdapter(options: GitLabStatusOptions): GitHostAdapter {
  const logger = options.logger?.child({ component: "git-gitlab" });

  return {
    metadata: getMetadata(),
    async setStatus(opts) {
      await postCommitStatus({
        owner: options.owner,
        repo: options.repo,
        host: options.host,
        token: options.token,
        context: opts.context,
        gitSha: opts.gitSha,
        status: opts.status,
        url: opts.url,
        logger,
      });
    },
    async isMerged(opts) {
      return await checkIsMerged({
        owner: options.owner,
        repo: options.repo,
        host: options.host,
        token: options.token,
        sha: opts.sha,
        branch: opts.branch,
        logger,
      });
    },
    async upsertComment(opts) {
      return await upsertMrNote({
        owner: options.owner,
        repo: options.repo,
        host: options.host,
        token: options.token,
        sha: opts.sha,
        url: opts.url,
        markdown: opts.markdown,
        prNumber: opts.prNumber,
        logger,
      });
    },
  };
}

export const gitLabHost: GitHostProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; token: string; logger?: Logger }): GitHostAdapter {
    const cfg = gitlabConfigSchema.parse(opts.config) as GitLabStatusOptions & { owner: string; repo: string };
    return createGitLabStatusAdapter({
      token: opts.token,
      owner: cfg.owner,
      repo: cfg.repo,
      host: cfg.host,
      logger: opts.logger,
    });
  },
};
