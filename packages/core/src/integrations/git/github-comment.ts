import type { Logger } from "../../logger.ts";
import { httpJson } from "../../utils/index.ts";
import { githubHeaders, repoPath } from "./github-api.ts";
import { findPrNumber } from "./github-pr.ts";
import type { GitHubRepo } from "./github-status.ts";
import {
  listAllPages,
  PAGE_SIZE,
  upsertReviewComment,
  type CommentInput,
  type ReviewThread,
} from "./review-comment.ts";

interface IssueComment {
  id: number;
  body?: string | null;
}

/** Fetch-backed review thread (comments) for a pull request. */
function createThread(repo: GitHubRepo, prNumber: number): ReviewThread {
  const threadUrl = repoPath(repo, `/issues/${prNumber}/comments`);
  const headers = githubHeaders(repo.token);
  return {
    list: async () => {
      const comments = await listAllPages((page) =>
        httpJson<IssueComment[]>(`${threadUrl}?per_page=${PAGE_SIZE}&page=${page}`, { headers }),
      );
      return comments.map((comment) => ({ id: comment.id, body: comment.body ?? "" }));
    },
    update: async (id, body) => {
      const updated = await httpJson<IssueComment>(
        repoPath(repo, `/issues/comments/${String(id)}`),
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

/** Create or update the StoryShelf review comment on the pull request of a commit. */
export async function upsertPrComment(
  repo: GitHubRepo,
  input: CommentInput & { logger?: Logger },
): Promise<string> {
  const { token, owner } = repo;
  return await upsertReviewComment({
    project: input.project,
    buildId: input.buildId,
    url: input.url,
    markdown: input.markdown,
    sha: input.sha,
    logger: input.logger,
    resolveNumber: async () =>
      await findPrNumber({ token, owner, repo: repo.repo, apiUrl: repo.apiUrl, sha: input.sha }),
    thread: (prNumber) => createThread(repo, prNumber),
  });
}
