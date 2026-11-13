import type { StateAnnotation } from "../../adapters/notifier/index.ts";
import { httpJson } from "../../utils/index.ts";
import { githubHeaders, repoPath } from "./github-api.ts";
import { findingKey, findingsHash, markedHash } from "./github-check-mapper.ts";
import type { CheckRepo, ExistingRun } from "./github-check.ts";

/** One annotation as the list endpoint returns it. */
interface ListedAnnotation {
  path: string;
  annotation_level: string;
  title?: string | null;
  message?: string | null;
  raw_details?: string | null;
}

/** Annotations the list endpoint returns per page, and the pages read before giving up. */
const LIST_PAGE = 100;
const LIST_PAGES = 10;

/** What to post: the findings the run lacks, and how many of its annotations are history. */
export interface AnnotationPlan {
  post: readonly StateAnnotation[];
  resolved: number;
}

/**
 * Compare the findings with what `run` shows (nothing when there is no run). A status without
 * findings (a review or storybook run, or a state that carries none) has no set to compare:
 * nothing is posted, and what the run holds is not counted as history.
 */
export async function planAnnotations(
  repo: CheckRepo,
  run: ExistingRun | undefined,
  findings?: readonly StateAnnotation[],
): Promise<AnnotationPlan> {
  const shown = run?.output?.annotations_count ?? 0;
  if (findings === undefined) {
    return { post: [], resolved: 0 };
  }
  if (run === undefined || shown === 0) {
    return { post: findings, resolved: 0 };
  }
  // The same set, and every annotation is there: nothing to post. (A post cut short has no hash
  // on the run, and a run with fewer annotations than findings is compared one by one.)
  if (markedHash(run.output?.summary) === findingsHash(findings) && shown >= findings.length) {
    return { post: [], resolved: shown - findings.length };
  }
  return await compareWithListing(repo, run.id, { findings, shown });
}

/** Read the annotations the run has and keep the findings none of them matches. */
async function compareWithListing(
  repo: CheckRepo,
  id: number,
  what: { findings: readonly StateAnnotation[]; shown: number },
): Promise<AnnotationPlan> {
  const listed = await listAnnotations(repo, id, 1, []);
  const keys = new Set(listed.map((annotation) => keyOfListed(annotation)));
  const post = what.findings.filter((finding) => !keys.has(findingKey(finding)));
  return { post, resolved: Math.max(0, what.shown - (what.findings.length - post.length)) };
}

function keyOfListed(annotation: ListedAnnotation): string {
  return findingKey({
    level: annotation.annotation_level,
    path: annotation.path,
    title: annotation.title ?? "",
    message: annotation.message ?? "",
    url: annotation.raw_details ?? "",
  });
}

/** The annotations of a run, page by page (bounded: a run with more history reposts a finding). */
async function listAnnotations(
  repo: CheckRepo,
  id: number,
  page: number,
  seen: ListedAnnotation[],
): Promise<ListedAnnotation[]> {
  const url = repoPath(
    repo.owner,
    repo.repo,
    `/check-runs/${String(id)}/annotations?per_page=${String(LIST_PAGE)}&page=${String(page)}`,
  );
  const listed = await httpJson<ListedAnnotation[]>(url, { headers: githubHeaders(repo.token) });
  const all = [...seen, ...listed];
  return listed.length < LIST_PAGE || page >= LIST_PAGES
    ? all
    : await listAnnotations(repo, id, page + 1, all);
}
