import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { apiBase, gitlabHeaders, projectId } from "./gitlab-api.ts";
import { findMrIid } from "./gitlab-pr.ts";
import type { GitLabProject } from "./gitlab-status.ts";
import { upsertReviewComment, type ReviewThread } from "./review-comment.ts";

interface MergeRequestNote {
  id: number;
  body?: string | null;
}

/** Fetch-backed review thread (notes) for a merge request. */
function createThread(
  base: string,
  pid: string,
  iid: number,
  headers: Record<string, string>,
): ReviewThread {
  const threadUrl = `${base}/api/v4/projects/${pid}/merge_requests/${iid}/notes`;
  return {
    list: async () => {
      try {
        const notes = await httpJson<MergeRequestNote[]>(`${threadUrl}?per_page=100`, { headers });
        return notes.map((note) => ({ id: note.id, body: note.body ?? "" }));
      } catch {
        return [];
      }
    },
    update: async (id, body) => {
      const updated = await httpJson<MergeRequestNote>(`${threadUrl}/${String(id)}`, {
        method: "PUT",
        headers,
        json: { body },
      });
      return String(updated.id);
    },
    create: async (body) => {
      const created = await httpJson<MergeRequestNote>(threadUrl, {
        method: "POST",
        headers,
        json: { body },
      });
      return String(created.id);
    },
  };
}

/** Create or update the StoryShelf review note on the merge request of a commit. */
export async function upsertMrNote(
  project: GitLabProject,
  input: { sha: string; url: string; markdown: string; logger?: Logger },
): Promise<string> {
  const { host, owner, repo, token } = project;
  const base = apiBase(host);
  const pid = projectId(owner, repo);
  const headers = gitlabHeaders(token);
  return await upsertReviewComment({
    url: input.url,
    markdown: input.markdown,
    sha: input.sha,
    logger: input.logger,
    resolveNumber: async () => await findMrIid({ host, owner, repo, token, sha: input.sha }),
    thread: (iid) => createThread(base, pid, iid, headers),
  });
}
