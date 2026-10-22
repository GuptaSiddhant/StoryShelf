import type { StateNotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { upsertPrComment } from "./github-comment.ts";
import { githubConfigSchema } from "./github-config.ts";
import { postCommitStatus, type GitHubRepo } from "./github-status.ts";
import { createStateAdapter, requireToken } from "./state-adapter.ts";
import { packageVersion } from "./version.ts";

/** GitHub commit status and pull-request comment provider (`state` delivery). */
export const gitHubNotifier: StateNotifierProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; secret?: string; logger?: Logger }) {
    const cfg = githubConfigSchema.parse(opts.config);
    const logger = opts.logger?.child({ component: "notify-git-github" });
    const repo: GitHubRepo = {
      token: requireToken(opts.secret, "GitHub"),
      owner: cfg.owner,
      repo: cfg.repo,
      logger,
    };
    return createStateAdapter(
      getMetadata(),
      {
        status: async (input) => {
          await postCommitStatus(repo, input);
        },
        comment: async (input) => await upsertPrComment(repo, { ...input, logger }),
      },
      logger,
    );
  },
};

/** Describe the GitHub provider (name, version, config schema). */
export function getMetadata(): StateNotifierProvider["metadata"] {
  return {
    name: "GitHub",
    version: packageVersion(),
    description: "Commit statuses and pull-request comments via the GitHub REST API",
    kind: "github",
    category: "notifier",
    delivery: "state",
    logo: "github",
    schema: githubConfigSchema,
  };
}
