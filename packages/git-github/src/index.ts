import { Octokit } from "@octokit/rest";
import { z } from "zod";

import type { Logger } from "pino";
import type { CheckStatus, GitAdapter } from "@storyshelf/core";

declare const __PKG_VERSION__: string;

export const githubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
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
  /** Optional logger for diagnostics. */
  logger?: Logger;
}

/**
 * Create a GitHub-backed `GitAdapter` (configured instance).
 *
 * Posts commit statuses to GitHub using the REST API.
 * Context format: `storyshelf/{project-slug}` (e.g., "storyshelf/my-app").
 *
 * @param options - Configuration including token, owner, repo.
 * @returns A `GitAdapter` implementation.
 */
export function createGitHubStatusAdapter(options: GitHubStatusOptions): GitAdapter {
  const octokit = new Octokit({ auth: options.token });
  const logger = options.logger?.child({ component: "git-github" });

  return {
    metadata: {
      name: "GitHub",
      version: typeof __PKG_VERSION__ === "undefined" ? "0.0.0" : __PKG_VERSION__, // oxlint-disable-line unicorn/no-typeof-undefined
      description: "Commit statuses via GitHub REST API",
      kind: "github",
      logo: "github",
      schema: githubConfigSchema,
    },
    withConfig(opts: { config: unknown; token: string; logger?: Logger }): GitAdapter {
      const cfg = githubConfigSchema.parse(opts.config);
      return createGitHubStatusAdapter({
        token: opts.token,
        owner: cfg.owner,
        repo: cfg.repo,
        logger: opts.logger,
      });
    },
    async setStatus(context: string, gitSha: string, status: CheckStatus, url: string): Promise<void> {
      const ghContext = `storyshelf/${context}`;
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

export const githubAdapter: GitAdapter = {
  metadata: {
    name: "GitHub",
    version: typeof __PKG_VERSION__ === "undefined" ? "0.0.0" : __PKG_VERSION__, // oxlint-disable-line unicorn/no-typeof-undefined
    description: "Commit statuses via GitHub REST API",
    kind: "github",
    logo: "github",
    schema: githubConfigSchema,
  },
  withConfig(opts: { config: unknown; token: string; logger?: Logger }): GitAdapter {
    const cfg = githubConfigSchema.parse(opts.config);
    return createGitHubStatusAdapter({
      token: opts.token,
      owner: cfg.owner,
      repo: cfg.repo,
      logger: opts.logger,
    });
  },
  // eslint-disable-next-line require-await
  async setStatus(): Promise<void> {
    throw new Error("withConfig required — call githubAdapter.withConfig({config, token}) first");
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
