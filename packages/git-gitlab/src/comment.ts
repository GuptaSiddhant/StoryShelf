import type { ReviewThread } from "@storyshelf/core/adapter/git-host/comments";
import { upsertReviewComment } from "@storyshelf/core/adapter/git-host/comments";
import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { apiBase, gitlabHeaders, projectId } from "./helpers.ts";
import { findMrIid } from "./pr.ts";

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

/** Create or update the StoryShelf review note on a merge request. */
export async function upsertMrNote(opts: {
  owner: string;
  repo: string;
  host: string | undefined;
  token: string;
  sha: string;
  url: string;
  markdown: string;
  prNumber: number | undefined;
  logger?: Logger;
}): Promise<string> {
  const { host, owner, repo, token } = opts;
  const base = apiBase(host);
  const pid = projectId(owner, repo);
  const headers = gitlabHeaders(token);
  return await upsertReviewComment({
    url: opts.url,
    markdown: opts.markdown,
    prNumber: opts.prNumber,
    sha: opts.sha,
    logger: opts.logger,
    resolveNumber: async () => await findMrIid({ host, owner, repo, token, sha: opts.sha }),
    thread: (iid) => createThread(base, pid, iid, headers),
  });
}
