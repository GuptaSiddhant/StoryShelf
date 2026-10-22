/** URL-encode an `owner/repo` pair as a GitLab project ID. */
export function projectId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
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
