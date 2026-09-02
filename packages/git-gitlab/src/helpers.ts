export function projectId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

export function apiBase(host: string | undefined): string {
  const base = host ?? "https://gitlab.com";
  return base.replace(/\/+$/u, "");
}

export function gitlabHeaders(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "content-type": "application/json",
  };
}
