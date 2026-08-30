import { Octokit } from "@octokit/rest";
import { z } from "zod";

import type { Logger } from "pino";
import type { CheckStatus, StatusAdapter, StatusProvider } from "@storyshelf/core";

export const githubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  contextPrefix: z.string().optional(),
});

export type GitHubConfig = z.infer<typeof githubConfigSchema>;

/** Options for configuring the GitHub status adapter. */
export interface GitHubStatusOptions {
  /** GitHub Personal Access Token or App installation token. */
  token: string;
  /** Repository owner (user or org). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Context prefix for statuses. Defaults to "storyshelf". */
  contextPrefix?: string;
  /** Optional logger for diagnostics. */
  logger?: Logger;
}

/**
 * Create a GitHub-backed `StatusAdapter`.
 *
 * Posts commit statuses to GitHub using the REST API.
 * Context format: `${contextPrefix}/{project-slug}` (e.g., "storyshelf/my-app").
 *
 * @param options - Configuration including token, owner, repo.
 * @returns A `StatusAdapter` implementation.
 */
export function createGitHubStatusAdapter(options: GitHubStatusOptions): StatusAdapter {
  const octokit = new Octokit({ auth: options.token });
  const contextPrefix = options.contextPrefix ?? "storyshelf";
  const logger = options.logger?.child({ component: "status-github" });

  return {
    async setStatus(context: string, gitSha: string, status: CheckStatus, url: string): Promise<void> {
      const ghContext = `${contextPrefix}/${context}`;
      const state = mapStatus(status);

      logger?.debug({ context: ghContext, sha: gitSha, state, url }, "posting commit status");

      try {
        await octokit.repos.createCommitStatus({
          owner: options.owner,
          repo: options.repo,
          sha: gitSha,
          state,
          context: ghContext,
          target_url: url,
          description: describeStatus(status),
        });
        logger?.info({ context: ghContext, sha: gitSha, state }, "commit status posted");
      } catch (error) {
        logger?.error({ err: error, context: ghContext, sha: gitSha }, "failed to post commit status");
        throw error;
      }
    },
  };
}

export const githubStatusProvider: StatusProvider = {
  provider: "github",
  name: "GitHub",
  description: "Commit statuses via GitHub REST API",
  version: "1.0.0",
  logo: "github",
  configSchema: githubConfigSchema,
  create(opts: { config: unknown; token: string; logger?: Logger }): StatusAdapter {
    const cfg = githubConfigSchema.parse(opts.config);
    return createGitHubStatusAdapter({
      token: opts.token,
      owner: cfg.owner,
      repo: cfg.repo,
      contextPrefix: cfg.contextPrefix,
      logger: opts.logger,
    });
  },
};

function mapStatus(status: CheckStatus): "pending" | "success" | "failure" | "error" {
  switch (status) {
    case "pending":
      return "pending";
    case "success":
      return "success";
    case "failure":
      return "failure";
    default:
      return "error";
  }
}

function describeStatus(status: CheckStatus): string {
  switch (status) {
    case "pending":
      return "Visual tests pending";
    case "success":
      return "Visual tests passed";
    case "failure":
      return "Visual changes detected or tests failed";
    default:
      return "Visual changes detected or tests failed";
  }
}