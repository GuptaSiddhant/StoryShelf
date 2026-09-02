import { Octokit } from "@octokit/rest";
import { z } from "zod";

import type { Logger } from "pino";
import type { CheckStatus, GitHostAdapter, GitHostProvider } from "@storyshelf/core";

declare const __PKG_VERSION__: string;

const githubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

type GitHubConfig = z.infer<typeof githubConfigSchema>;

interface GitHubStatusOptions {
  token: string;
  owner: string;
  repo: string;
  logger?: Logger;
}

function getMetadata(): GitHostProvider["metadata"] {
  return {
    name: "GitHub",
    version: typeof __PKG_VERSION__ === "undefined" ? "0.0.0" : __PKG_VERSION__, // oxlint-disable-line unicorn/no-typeof-undefined
    description: "Commit statuses via GitHub REST API",
    kind: "github",
    logo: "github",
    schema: githubConfigSchema,
  };
}

function createGitHubStatusAdapter(options: GitHubStatusOptions): GitHostAdapter {
  const octokit = new Octokit({ auth: options.token });
  const logger = options.logger?.child({ component: "git-github" });

  async function findPrNumber(sha: string): Promise<number | undefined> {
    try {
      const pulls = await octokit.repos.listPullRequestsAssociatedWithCommit({
        owner: options.owner,
        repo: options.repo,
        commit_sha: sha,
      });
      const pr = pulls.data[0];
      if (pr && typeof pr.number === "number") {
        return pr.number;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  return {
    metadata: getMetadata(),
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
    async isMerged(opts: { sha: string; branch: string }): Promise<boolean> {
      try {
        const prNumber = await findPrNumber(opts.sha);
        if (prNumber === undefined) {
          const pulls = await octokit.pulls.list({
            owner: options.owner,
            repo: options.repo,
            head: `${options.owner}:${opts.branch}`,
            state: "closed",
            per_page: 5,
          });
          const pr = pulls.data.find((p) => p.merge_commit_sha === opts.sha || p.head.sha === opts.sha);
          return pr?.merged_at != null;
        }
        const pr = await octokit.pulls.get({
          owner: options.owner,
          repo: options.repo,
          pull_number: prNumber,
        });
        return pr.data.merged === true;
      } catch (error) {
        logger?.debug({ err: error, sha: opts.sha, branch: opts.branch }, "isMerged check failed, not skipping");
        return false;
      }
    },
    async upsertComment(opts: {
      prNumber?: number;
      sha: string;
      url: string;
      status: CheckStatus;
      markdown: string;
    }): Promise<string> {
      const marker = `<!-- storyshelf:${opts.url} -->`;
      const body = `${marker}\n${opts.markdown}`;
      let prNumber = opts.prNumber;
      if (prNumber === undefined) {
        prNumber = await findPrNumber(opts.sha);
      }
      if (prNumber === undefined) {
        logger?.debug({ sha: opts.sha }, "no PR found for comment, skipping");
        return "";
      }
      try {
        const comments = await octokit.issues.listComments({
          owner: options.owner,
          repo: options.repo,
          issue_number: prNumber,
          per_page: 100,
        });
        const existing = comments.data.find((c) => c.body?.includes(marker));
        if (existing) {
          const updated = await octokit.issues.updateComment({
            owner: options.owner,
            repo: options.repo,
            comment_id: existing.id,
            body,
          });
          logger?.info({ prNumber, commentId: updated.data.id }, "git comment updated");
          return String(updated.data.id);
        }
        const created = await octokit.issues.createComment({
          owner: options.owner,
          repo: options.repo,
          issue_number: prNumber,
          body,
        });
        logger?.info({ prNumber, commentId: created.data.id }, "git comment created");
        return String(created.data.id);
      } catch (error) {
        logger?.error({ err: error, prNumber }, "failed to upsert git comment");
        throw error;
      }
    },
  };
}

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
