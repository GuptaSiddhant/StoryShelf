import type { StateNotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { installationToken } from "./github-app.ts";
import { postCheckRun } from "./github-check.ts";
import { upsertPrComment } from "./github-comment.ts";
import { githubConfigSchema, type GitHubConfig } from "./github-config.ts";
import { postCommitStatus, type GitHubRepo } from "./github-status.ts";
import { createStateAdapter, requireToken, type StateWriter } from "./state-adapter.ts";
import { packageVersion } from "./version.ts";

/**
 * GitHub provider (`state` delivery). In `statuses` mode (default) it posts commit statuses with
 * the channel's token; in `checks` mode it posts check runs as the channel's GitHub App. Either
 * way it also keeps the pull-request comment.
 */
export const gitHubNotifier: StateNotifierProvider = {
  metadata: getMetadata(),
  create(opts: { config: unknown; secret?: string; logger?: Logger }) {
    const cfg = githubConfigSchema.parse(opts.config);
    const logger = opts.logger?.child({ component: "notify-git-github" });
    const secret = requireToken(
      opts.secret,
      "GitHub",
      cfg.mode === "checks" ? "a private key" : "a token",
    );
    const token = tokenSource(cfg, secret);
    const repo = async (): Promise<GitHubRepo> => ({
      token: await token(),
      owner: cfg.owner,
      repo: cfg.repo,
      logger,
    });
    const writer: StateWriter = {
      status: async (input) => {
        await (cfg.mode === "checks"
          ? postCheckRun(await repo(), input)
          : postCommitStatus(await repo(), input));
      },
      comment: async (input) => await upsertPrComment(await repo(), { ...input, logger }),
    };
    return createStateAdapter(getMetadata(), writer, logger);
  },
};

/** The token every request uses: the channel's token, or the App's installation token. */
function tokenSource(cfg: GitHubConfig, secret: string): () => Promise<string> {
  if (cfg.mode !== "checks" || cfg.appId === undefined || cfg.installationId === undefined) {
    return async () => await Promise.resolve(secret);
  }
  const creds = { appId: cfg.appId, installationId: cfg.installationId, privateKey: secret };
  return async () => await installationToken(creds);
}

/** Describe the GitHub provider (name, version, config schema). */
export function getMetadata(): StateNotifierProvider["metadata"] {
  return {
    name: "GitHub",
    version: packageVersion(),
    description:
      "Commit statuses or GitHub App check runs, and pull-request comments, via the GitHub REST API",
    kind: "github",
    category: "notifier",
    delivery: "state",
    logo: "github",
    schema: githubConfigSchema,
  };
}
