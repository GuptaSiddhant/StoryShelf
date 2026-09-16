/** GitHub REST API helpers (base URL + auth headers). */
export function apiBase(): string {
  return "https://api.github.com";
}

/** Join a `/repos/{owner}/{repo}` path with a suffix. */
export function repoPath(owner: string, repo: string, suffix = ""): string {
  return `${apiBase()}/repos/${owner}/${repo}${suffix}`;
}

/** Headers for GitHub REST API requests. */
export function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}
