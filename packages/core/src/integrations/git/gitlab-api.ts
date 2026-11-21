/** URL-encode an `owner/repo` pair as a GitLab project ID. */
export function projectId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

/**
 * How a project is addressed: its numeric id when a repository link pinned one (ADR 0054, so a
 * project re-created under the same path answers 404), else the URL-encoded `owner/repo` path.
 */
export function projectRef(project: {
  owner: string;
  repo: string;
  projectId?: string | undefined;
}): string {
  return project.projectId ?? projectId(project.owner, project.repo);
}

/** Normalize a GitLab host URL (defaults to gitlab.com, no trailing slash). */
export function apiBase(host = "https://gitlab.com"): string {
  return host.replace(/\/+$/u, "");
}

/** Build the auth headers for GitLab API requests. */
export function gitlabHeaders(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "content-type": "application/json",
  };
}
