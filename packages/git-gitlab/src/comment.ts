/* oxlint-disable max-statements, max-lines-per-function */
import { apiBase, gitlabHeaders, projectId } from "./helpers.ts";
import { findMrIid } from "./pr.ts";

import type { Logger } from "@storyshelf/core/types";

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
  const marker = `<!-- storyshelf:${opts.url} -->`;
  const body = `${marker}\n${opts.markdown}`;
  let iid: number | undefined = opts.prNumber;
  iid ??= await findMrIid({
    host: opts.host,
    owner: opts.owner,
    repo: opts.repo,
    token: opts.token,
    sha: opts.sha,
  });
  if (iid === undefined) {
    opts.logger?.debug({ sha: opts.sha }, "no MR found for comment, skipping");
    return "";
  }
  const base = apiBase(opts.host);
  const pid = projectId(opts.owner, opts.repo);
  try {
    const listUrl = `${base}/api/v4/projects/${pid}/merge_requests/${iid}/notes?per_page=100`;
    const res = await fetch(listUrl, { headers: gitlabHeaders(opts.token) });
    if (res.ok) {
      const notes = (await res.json()) as { id: number; body: string }[];
      const existing = notes.find((note) => note.body.includes(marker));
      if (existing) {
        const upd = await fetch(`${base}/api/v4/projects/${pid}/merge_requests/${iid}/notes/${existing.id}`, {
          method: "PUT",
          headers: gitlabHeaders(opts.token),
          body: JSON.stringify({ body }),
        });
        if (!upd.ok) {
          const text = await upd.text();
          throw new Error(`update note ${upd.status}: ${text}`);
        }
        const data = (await upd.json()) as { id: number };
        opts.logger?.info({ iid, commentId: data.id }, "gitlab comment updated");
        return String(data.id);
      }
    }
    const createdRes = await fetch(`${base}/api/v4/projects/${pid}/merge_requests/${iid}/notes`, {
      method: "POST",
      headers: gitlabHeaders(opts.token),
      body: JSON.stringify({ body }),
    });
    if (!createdRes.ok) {
      const text = await createdRes.text();
      throw new Error(`create note ${createdRes.status}: ${text}`);
    }
    const data = (await createdRes.json()) as { id: number };
    opts.logger?.info({ iid, commentId: data.id }, "gitlab comment created");
    return String(data.id);
  } catch (error) {
    opts.logger?.error({ err: error, iid }, "failed to upsert gitlab comment");
    throw error;
  }
}
