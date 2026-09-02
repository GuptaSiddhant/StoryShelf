export function projectId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

export function apiBase(host = "https://gitlab.com"): string {
  return host.replace(/\/+$/u, "");
}

export function gitlabHeaders(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "content-type": "application/json",
  };
}
