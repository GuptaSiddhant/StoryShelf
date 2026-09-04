import { apiBase, gitlabHeaders, projectId } from "./helpers.ts";

/** Find the merge request IID associated with a commit SHA, if any. */
export async function findMrIid(opts: {
  host: string | undefined;
  owner: string;
  repo: string;
  token: string;
  sha: string;
}): Promise<number | undefined> {
  try {
    const base = apiBase(opts.host);
    const pid = projectId(opts.owner, opts.repo);
    const url = `${base}/api/v4/projects/${pid}/repository/commits/${encodeURIComponent(opts.sha)}/merge_requests`;
    const res = await fetch(url, { headers: gitlabHeaders(opts.token) });
    if (!res.ok) {
      return undefined;
    }
    const data = (await res.json()) as { iid: number }[];
    return data[0]?.iid;
  } catch {
    return undefined;
  }
}
