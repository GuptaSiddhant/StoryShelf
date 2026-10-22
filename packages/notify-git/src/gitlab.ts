import type { StateNotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { upsertMrNote } from "./gitlab-comment.ts";
import { gitlabConfigSchema } from "./gitlab-config.ts";
import { postCommitStatus, type GitLabProject } from "./gitlab-status.ts";
import { createStateAdapter, requireToken } from "./state-adapter.ts";
import { packageVersion } from "./version.ts";

/** GitLab commit status and merge-request note provider (`state` delivery). */
export const gitLabNotifier: StateNotifierProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; secret?: string; logger?: Logger }) {
    const cfg = gitlabConfigSchema.parse(opts.config);
    const logger = opts.logger?.child({ component: "notify-git-gitlab" });
    const project: GitLabProject = {
      token: requireToken(opts.secret, "GitLab"),
      owner: cfg.owner,
      repo: cfg.repo,
      host: cfg.host,
      logger,
    };
    return createStateAdapter(
      getMetadata(),
      {
        status: async (input) => {
          await postCommitStatus(project, input);
        },
        comment: async (input) => await upsertMrNote(project, { ...input, logger }),
      },
      logger,
    );
  },
};

/** Describe the GitLab provider (name, version, config schema). */
export function getMetadata(): StateNotifierProvider["metadata"] {
  return {
    name: "GitLab",
    version: packageVersion(),
    description: "Commit statuses and merge-request notes via the GitLab API",
    kind: "gitlab",
    category: "notifier",
    delivery: "state",
    logo: "gitlab",
    schema: gitlabConfigSchema,
  };
}
