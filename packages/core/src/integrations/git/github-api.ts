/**
 * GitHub REST API helpers (base URL + auth headers). `apiUrl` is a GitHub Enterprise Server API
 * base such as `https://ghes.example.com/api/v3`; every request still goes through the outbound guard.
 */
export function apiBase(apiUrl?: string): string {
  return apiUrl ? apiUrl.replace(/\/+$/u, "") : "https://api.github.com";
}

/** Join a `/repos/{owner}/{repo}` path with a suffix. */
export function repoPath(
  target: { owner: string; repo: string; apiUrl?: string | undefined },
  suffix = "",
): string {
  return `${apiBase(target.apiUrl)}/repos/${target.owner}/${target.repo}${suffix}`;
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
