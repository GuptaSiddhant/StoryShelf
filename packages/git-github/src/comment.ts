import type { ReviewThread } from "@storyshelf/core/adapter/git-host/comments";
import { upsertReviewComment } from "@storyshelf/core/adapter/git-host/comments";
import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { githubHeaders, repoPath } from "./api.ts";
import { findPrNumber } from "./pr.ts";

interface IssueComment {
  id: number;
  body?: string | null;
}

/** Fetch-backed review thread (comments) for a pull request. */
function createThread(token: string, owner: string, repo: string, prNumber: number): ReviewThread {
  const threadUrl = repoPath(owner, repo, `/issues/${prNumber}/comments`);
  const headers = githubHeaders(token);
  return {
    list: async () => {
      const comments = await httpJson<IssueComment[]>(`${threadUrl}?per_page=100`, { headers });
      return comments.map((comment) => ({ id: comment.id, body: comment.body ?? "" }));
    },
    update: async (id, body) => {
      const updated = await httpJson<IssueComment>(
        repoPath(owner, repo, `/issues/comments/${String(id)}`),
        { method: "PATCH", headers, json: { body } },
      );
      return String(updated.id);
    },
    create: async (body) => {
      const created = await httpJson<IssueComment>(threadUrl, {
        method: "POST",
        headers,
        json: { body },
      });
      return String(created.id);
    },
  };
}

/** Create or update the StoryShelf review comment on a pull request. */
export async function upsertPrComment(opts: {
  token: string;
  owner: string;
  repo: string;
  sha: string;
  url: string;
  markdown: string;
  prNumber: number | undefined;
  logger?: Logger;
}): Promise<string> {
  const { token, owner, repo } = opts;
  return await upsertReviewComment({
    url: opts.url,
    markdown: opts.markdown,
    prNumber: opts.prNumber,
    sha: opts.sha,
    logger: opts.logger,
    resolveNumber: async () => await findPrNumber({ token, owner, repo, sha: opts.sha }),
    thread: (prNumber) => createThread(token, owner, repo, prNumber),
  });
}
