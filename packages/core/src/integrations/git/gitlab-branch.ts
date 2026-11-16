import { httpJson } from "../../utils/index.ts";
import { apiBase, gitlabHeaders, projectId } from "./gitlab-api.ts";
import type { GitLabProject } from "./gitlab-status.ts";

/** Branches read per page of GitLab's commit refs. */
const PER_PAGE = 100;
/** Pages read at most; a commit contained in more branches than this is not confirmed (fail closed). */
const MAX_PAGES = 10;

/** One entry of GitLab's commit refs answer. */
interface RefEntry {
  type?: unknown;
  name?: unknown;
}

/**
 * Whether GitLab says `sha` is on `branch` (ADR 0009, amendment 2026-11-13): the branches that
 * contain the commit (`/repository/commits/:sha/refs?type=branch`) include it. The host is
 * project-set, so every request goes through the outbound guard (`destination: "project"`). A
 * failed request throws, so the caller fails closed.
 */
export async function commitOnBranch(
  project: GitLabProject,
  input: { sha: string; branch: string },
): Promise<boolean> {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- pages are read in order and stop at a match
    const refs = await refsPage(project, input.sha, page);
    if (refs.some((ref) => ref.type === "branch" && ref.name === input.branch)) {
      return true;
    }
    if (refs.length < PER_PAGE) {
      return false;
    }
  }
  return false;
}

async function refsPage(project: GitLabProject, sha: string, page: number): Promise<RefEntry[]> {
  const base = apiBase(project.host);
  const pid = projectId(project.owner, project.repo);
  const query = `type=branch&per_page=${String(PER_PAGE)}&page=${String(page)}`;
  const answer = await httpJson<unknown>(
    `${base}/api/v4/projects/${pid}/repository/commits/${encodeURIComponent(sha)}/refs?${query}`,
    {
      method: "GET",
      headers: gitlabHeaders(project.token),
      logger: project.logger,
      destination: "project",
    },
  );
  return Array.isArray(answer) ? (answer as RefEntry[]) : [];
}
