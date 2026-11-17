import { httpJson } from "../../utils/index.ts";
import { apiBase, gitlabHeaders, projectId } from "./gitlab-api.ts";

interface CommitMergeRequest {
  iid: number;
  state?: string;
}

/**
 * Find the open merge request associated with a commit SHA, if any. GitLab also lists merged and
 * closed merge requests, and those get no comment.
 */
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
    return data.find((mr) => mr.state === "opened")?.iid;
  } catch {
    return undefined;
  }
}
