import type { Octokit } from "@octokit/rest";
import type { ReviewThread } from "@storyshelf/core/adapter/git-host/comments";
import { upsertReviewComment } from "@storyshelf/core/adapter/git-host/comments";
import type { Logger } from "@storyshelf/core/logger";
import { findPrNumber } from "./pr.ts";

/** Octokit-backed review thread for a pull request. */
function createThread(octokit: Octokit, owner: string, repo: string, prNumber: number): ReviewThread {
  return {
    list: async () =>
      (
        await octokit.issues.listComments({
          owner,
          repo,
          issue_number: prNumber,
          per_page: 100,
        })
      ).data.map((comment) => ({ id: comment.id, body: comment.body ?? "" })),
    update: async (id, body) =>
      String(
        (
          await octokit.issues.updateComment({
            owner,
            repo,
            comment_id: id as number,
            body,
          })
        ).data.id,
      ),
    create: async (body) =>
      String(
        (
          await octokit.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body,
          })
        ).data.id,
      ),
  };
}

/** Create or update the StoryShelf review comment on a pull request. */
export async function upsertPrComment(opts: {
  octokit: Octokit;
  owner: string;
  repo: string;
  sha: string;
  url: string;
  markdown: string;
  prNumber: number | undefined;
  logger?: Logger;
}): Promise<string> {
  const { octokit, owner, repo } = opts;
  return await upsertReviewComment({
    url: opts.url,
    markdown: opts.markdown,
    prNumber: opts.prNumber,
    sha: opts.sha,
    logger: opts.logger,
    resolveNumber: async () => await findPrNumber({ octokit, owner, repo, sha: opts.sha }),
    thread: (prNumber) => createThread(octokit, owner, repo, prNumber),
  });
}
