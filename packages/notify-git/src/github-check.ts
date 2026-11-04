import type { StateAnnotation } from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { githubHeaders, repoPath } from "./github-api.ts";
import {
  annotationBatches,
  checkRunBody,
  externalIdOf,
  findingKey,
  findingsHash,
  markedHash,
  type CheckAnnotation,
  type CheckRunBody,
  type CheckRunInput,
} from "./github-check-mapper.ts";

/** Coordinates and installation token of one repository. */
export interface CheckRepo {
  token: string;
  owner: string;
  repo: string;
  logger?: Logger | undefined;
}

interface ExistingRun {
  id: number;
  external_id?: string | null;
  output?: { annotations_count?: number | null; summary?: string | null } | null;
}

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

/**
 * Show a status as a check run of the commit `sha`, one run per name: find the run that carries
 * the status's `external_id` and update it, or create it when there is none. A create can race
 * another delivery for the same commit and name (two channels, or two builds of one commit), so
 * after creating, the runs are listed again and any other run with the id is updated to the same
 * state; they cannot be deleted, and none is left showing an older one.
 *
 * The annotations are the findings of the build. GitHub keeps every annotation of a run, so what
 * is posted is the findings the run does not show yet, compared one by one; a run whose summary
 * carries the hash of the same set (and enough annotations) is left alone. The summary says how
 * many earlier annotations belong to findings that are no longer current.
 */
export async function postCheckRun(
  repo: CheckRepo,
  input: CheckRunInput & { sha: string },
): Promise<void> {
  const runs = await findRuns(repo, input);
  const plan = await planAnnotations(repo, runs[0], input.annotations);
  const body = checkRunBody({ ...input, resolved: plan.resolved });
  repo.logger?.debug(
    { context: input.context, sha: input.sha, status: body.status },
    "posting check run",
  );
  try {
    const written = await writeRun(repo, { input, body, run: runs[0], post: plan.post });
    await alignOthers(repo, input, { body, written, known: runs });
  } catch (error) {
    repo.logger?.error(
      { err: error, context: input.context, sha: input.sha },
      "failed to post check run",
    );
    throw error;
  }
}

/** Update `run` (or create the run) with the body and the annotations to post, in batches. */
async function writeRun(
  repo: CheckRepo,
  what: {
    input: { sha: string };
    body: CheckRunBody;
    run: ExistingRun | undefined;
    post: readonly StateAnnotation[];
  },
): Promise<number> {
  const batches = annotationBatches(what.post);
  const first = withBatch(what.body, batches[0]);
  const id = what.run
    ? await updateRun(repo, what.run.id, first)
    : await createRun(repo, { ...first, head_sha: what.input.sha });
  await appendBatches(repo, id, { output: what.body.output, batches: batches.slice(1) });
  return id;
}

type WithAnnotations = Omit<CheckRunBody, "output"> & {
  output: CheckRunBody["output"] & { annotations?: CheckAnnotation[] };
};

function withBatch(body: CheckRunBody, batch: CheckAnnotation[] | undefined): WithAnnotations {
  return batch === undefined ? body : { ...body, output: { ...body.output, annotations: batch } };
}

/** What to post: the findings the run lacks, and how many of its annotations are history. */
interface AnnotationPlan {
  post: readonly StateAnnotation[];
  resolved: number;
}

/** Compare the findings with what `run` shows (nothing when there is no run). */
async function planAnnotations(
  repo: CheckRepo,
  run: ExistingRun | undefined,
  findings: readonly StateAnnotation[] | undefined,
): Promise<AnnotationPlan> {
  const current = findings ?? [];
  const shown = run?.output?.annotations_count ?? 0;
  if (run === undefined || shown === 0) {
    return { post: current, resolved: 0 };
  }
  // The same set, and every annotation is there: nothing to post. (A post cut short after its
  // summary was written has fewer annotations than findings, and falls through to the list.)
  if (
    findings !== undefined &&
    markedHash(run.output?.summary) === findingsHash(findings) &&
    shown >= findings.length
  ) {
    return { post: [], resolved: shown - findings.length };
  }
  const listed = await listAnnotations(repo, run.id, 1, []);
  const keys = new Set(listed.map((annotation) => keyOfListed(annotation)));
  const post = current.filter((finding) => !keys.has(findingKey(finding)));
  return { post, resolved: Math.max(0, shown - (current.length - post.length)) };
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

/** The runs of this commit that carry the status's `external_id`, oldest first. */
async function findRuns(
  repo: CheckRepo,
  input: { sha: string; context: string },
): Promise<ExistingRun[]> {
  const url = repoPath(
    repo.owner,
    repo.repo,
    `/commits/${encodeURIComponent(input.sha)}/check-runs?filter=all&per_page=100&check_name=${encodeURIComponent(input.context)}`,
  );
  const listed = await httpJson<{ check_runs?: ExistingRun[] }>(url, {
    headers: githubHeaders(repo.token),
  });
  return (listed.check_runs ?? [])
    .filter((run) => run.external_id === externalIdOf(input.context))
    .toSorted((first, second) => first.id - second.id);
}

async function createRun(repo: CheckRepo, body: unknown): Promise<number> {
  const created = await httpJson<{ id: number }>(repoPath(repo.owner, repo.repo, "/check-runs"), {
    method: "POST",
    headers: githubHeaders(repo.token),
    json: body,
    logger: repo.logger,
  });
  return created.id;
}

async function updateRun(repo: CheckRepo, id: number, body: unknown): Promise<number> {
  await httpJson(repoPath(repo.owner, repo.repo, `/check-runs/${String(id)}`), {
    method: "PATCH",
    headers: githubHeaders(repo.token),
    json: body,
    logger: repo.logger,
  });
  return id;
}

/**
 * Bring every other run with the id to the same state. After a create the runs are listed
 * again, since another delivery may have created one too; the ones already known are updated on
 * every post, so a duplicate never keeps an older state.
 */
async function alignOthers(
  repo: CheckRepo,
  input: { sha: string; context: string },
  state: { body: CheckRunBody; written: number; known: readonly ExistingRun[] },
): Promise<void> {
  const runs = state.known.length === 0 ? await findRuns(repo, input) : state.known;
  const others = runs.filter((run) => run.id !== state.written);
  await Promise.all(others.map(async (run) => await updateRun(repo, run.id, state.body)));
}

/** Append the remaining annotation batches to the run, one request after the other (in order). */
async function appendBatches(
  repo: CheckRepo,
  id: number,
  rest: { output: CheckRunBody["output"]; batches: CheckAnnotation[][] },
): Promise<void> {
  const [next, ...later] = rest.batches;
  if (next === undefined) {
    return;
  }
  await updateRun(repo, id, { output: { ...rest.output, annotations: next } });
  await appendBatches(repo, id, { output: rest.output, batches: later });
}
