import { httpJson } from "../../utils/index.ts";
import { githubHeaders, repoPath } from "./github-api.ts";
import type { GitHubRepo } from "./github-status.ts";

/** The part of GitHub's compare answer the check reads. */
interface CompareAnswer {
  status?: unknown;
}

/**
 * Whether GitHub says `sha` is on `branch` (ADR 0009, amendment 2026-11-13): it compares the branch
 * with the commit, and `identical` or `behind` means the commit is the branch head or one of its
 * ancestors. Any other answer (`ahead`, `diverged`) is a no. A failed request throws, so the caller
 * fails closed; the token never appears in the error (`HttpError` carries the status, not headers).
 */
export async function commitOnBranch(
  repo: GitHubRepo,
  input: { sha: string; branch: string },
): Promise<boolean> {
  const range = `${encodeURIComponent(input.branch)}...${encodeURIComponent(input.sha)}`;
  const answer = await httpJson<CompareAnswer>(
    repoPath(repo.owner, repo.repo, `/compare/${range}?per_page=1`),
    { method: "GET", headers: githubHeaders(repo.token), logger: repo.logger },
  );
  return answer.status === "identical" || answer.status === "behind";
}
