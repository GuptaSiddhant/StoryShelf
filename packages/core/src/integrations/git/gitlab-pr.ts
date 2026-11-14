import { httpJson } from "../../utils/index.ts";
import { apiBase, gitlabHeaders, projectId } from "./gitlab-api.ts";

interface CommitMergeRequest {
  iid: number;
}

/** Find the merge request IID associated with a commit SHA, if any. */
export async function findMrIid(opts: {
  host?: string;
  owner: string;
  repo: string;
  token: string;
  sha: string;
}): Promise<number | undefined> {
  try {
    const base = apiBase(opts.host);
    const pid = projectId(opts.owner, opts.repo);
    const url = `${base}/api/v4/projects/${pid}/repository/commits/${encodeURIComponent(opts.sha)}/merge_requests`;
    const data = await httpJson<CommitMergeRequest[]>(url, {
      headers: gitlabHeaders(opts.token),
      destination: "project",
    });
    return data[0]?.iid;
  } catch {
    return undefined;
  }
}
