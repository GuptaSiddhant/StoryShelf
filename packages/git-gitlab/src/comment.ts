import type { ReviewThread } from "@storyshelf/core/adapter/git-host/comments";
import { upsertReviewComment } from "@storyshelf/core/adapter/git-host/comments";
import type { Logger } from "@storyshelf/core/logger";
import { apiBase, gitlabHeaders, projectId } from "./helpers.ts";
import { findMrIid } from "./pr.ts";

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
      const res = await fetch(`${threadUrl}?per_page=100`, { headers });
      if (!res.ok) {
        return [];
      }
      return (await res.json()) as { id: number; body: string }[];
    },
    update: async (id, body) => {
      const res = await fetch(`${threadUrl}/${String(id)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        throw new Error(`update note ${res.status}: ${await res.text()}`);
      }
      return String(((await res.json()) as { id: number }).id);
    },
    create: async (body) => {
      const res = await fetch(threadUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        throw new Error(`create note ${res.status}: ${await res.text()}`);
      }
      return String(((await res.json()) as { id: number }).id);
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
