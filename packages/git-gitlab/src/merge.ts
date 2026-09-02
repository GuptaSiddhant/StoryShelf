/* oxlint-disable max-statements, max-lines-per-function */
import { apiBase, gitlabHeaders, projectId } from "./helpers.ts";
import { findMrIid } from "./pr.ts";

import type { Logger } from "pino";

export async function checkIsMerged(opts: {
  owner: string;
  repo: string;
  host: string | undefined;
  token: string;
  sha: string;
  branch: string;
  logger?: Logger;
}): Promise<boolean> {
  try {
    const iid = await findMrIid({
      host: opts.host,
      owner: opts.owner,
      repo: opts.repo,
      token: opts.token,
      sha: opts.sha,
    });
    if (iid !== undefined) {
      const base = apiBase(opts.host);
      const pid = projectId(opts.owner, opts.repo);
      const res = await fetch(`${base}/api/v4/projects/${pid}/merge_requests/${iid}`, {
        headers: gitlabHeaders(opts.token),
      });
      if (!res.ok) return false;
      const mr = (await res.json()) as { state?: string; merged_at?: string | null };
      return mr.state === "merged" || mr.merged_at !== null && mr.merged_at !== undefined; // oxlint-disable-line eslint/no-eq-null, eslint/eqeqeq
    }
    const base = apiBase(opts.host);
    const pid = projectId(opts.owner, opts.repo);
    const res = await fetch(
      `${base}/api/v4/projects/${pid}/merge_requests?state=merged&source_branch=${encodeURIComponent(opts.branch)}&per_page=5`,
      { headers: gitlabHeaders(opts.token) },
    );
    if (!res.ok) return false;
    const mrs = (await res.json()) as Array<{ sha?: string; merge_commit_sha?: string | null }>;
    return mrs.some((mr) => mr.sha === opts.sha || mr.merge_commit_sha === opts.sha);
  } catch (error) {
    opts.logger?.debug({ err: error, sha: opts.sha, branch: opts.branch }, "isMerged check failed, not skipping");
    return false;
  }
}
