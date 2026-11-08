import type { StateAnnotation } from "@storyshelf/core/adapter/notifier";
import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { githubHeaders, repoPath } from "./github-api.ts";
import { planAnnotations } from "./github-check-annotations.ts";
import {
  annotationBatches,
  checkRunBody,
  externalIdOf,
  type CheckAnnotation,
  type CheckRunBody,
  type CheckRunInput,
  showsNewerBuild,
  withoutMarker,
} from "./github-check-mapper.ts";

/** Coordinates and installation token of one repository. */
export interface CheckRepo {
  token: string;
  owner: string;
  repo: string;
  /** The GitHub App the runs belong to: only its runs are found, updated and mirrored. */
  appId?: string | undefined;
  logger?: Logger | undefined;
}

export interface ExistingRun {
  id: number;
  external_id?: string | null;
  details_url?: string | null;
  output?: { annotations_count?: number | null; summary?: string | null } | null;
}

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
 *
 * A late delivery for an older build never overwrites a newer build's run: when a run of the commit
 * links to a newer build (ULIDs sort by time) than the delivered one, nothing is written.
 */
export async function postCheckRun(
  repo: CheckRepo,
  input: CheckRunInput & { sha: string },
): Promise<void> {
  const runs = await findRuns(repo, input);
  if (!isSuperseded(repo, runs, input)) {
    await postToRuns(repo, input, runs);
  }
}

/** Write the status to the run (or create it) and mirror it onto any duplicate. */
async function postToRuns(
  repo: CheckRepo,
  input: CheckRunInput & { sha: string },
  runs: readonly ExistingRun[],
): Promise<void> {
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

/** Whether a run of the commit shows a newer build than the delivered one (logged, not an error). */
function isSuperseded(
  repo: CheckRepo,
  runs: readonly ExistingRun[],
  input: { sha: string; context: string; url?: string | undefined },
): boolean {
  const newer = runs.some((run) => showsNewerBuild(run.details_url, input.url));
  if (newer) {
    repo.logger?.debug(
      { context: input.context, sha: input.sha },
      "check run shows a newer build; delivery skipped",
    );
  }
  return newer;
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
  // The finding-set hash goes on with the write that completes the annotations: a post cut short
  // leaves no hash, so the retry compares the annotations themselves.
  const interim = batches.length > 1 ? withoutMarker(what.body) : what.body;
  const first = withBatch(interim, batches[0]);
  const id = what.run
    ? await updateRun(repo, what.run.id, first)
    : await createRun(repo, { ...first, head_sha: what.input.sha });
  await appendBatches(repo, id, {
    output: { interim: interim.output, final: what.body.output },
    batches: batches.slice(1),
  });
  return id;
}

type WithAnnotations = Omit<CheckRunBody, "output"> & {
  output: CheckRunBody["output"] & { annotations?: CheckAnnotation[] };
};

function withBatch(body: CheckRunBody, batch: CheckAnnotation[] | undefined): WithAnnotations {
  return batch === undefined ? body : { ...body, output: { ...body.output, annotations: batch } };
}

/** Runs listed per page, and the pages read before giving up. */
const RUNS_PAGE = 100;
const RUNS_PAGES = 10;

/** The runs of this commit that carry the status's `external_id`, newest first (the one GitHub shows). */
async function findRuns(
  repo: CheckRepo,
  input: { sha: string; context: string },
): Promise<ExistingRun[]> {
  const all = await listRuns(repo, input, { page: 1, seen: [] });
  return all
    .filter((run) => run.external_id === externalIdOf(input.context))
    .toSorted((first, second) => second.id - first.id);
}

/** Every run of the commit with this name (of this App, when it is known), page by page. */
async function listRuns(
  repo: CheckRepo,
  input: { sha: string; context: string },
  at: { page: number; seen: ExistingRun[] },
): Promise<ExistingRun[]> {
  const app = repo.appId === undefined ? "" : `&app_id=${encodeURIComponent(repo.appId)}`;
  const url = repoPath(
    repo.owner,
    repo.repo,
    `/commits/${encodeURIComponent(input.sha)}/check-runs?filter=all&per_page=${String(RUNS_PAGE)}&page=${String(at.page)}&check_name=${encodeURIComponent(input.context)}${app}`,
  );
  const listed = await httpJson<{ check_runs?: ExistingRun[] }>(url, {
    headers: githubHeaders(repo.token),
  });
  const runs = listed.check_runs ?? [];
  const seen = [...at.seen, ...runs];
  return runs.length < RUNS_PAGE || at.page >= RUNS_PAGES
    ? seen
    : await listRuns(repo, input, { page: at.page + 1, seen });
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
  // Without the hash: these runs show the state, not the findings, so they must not claim the set.
  const mirror = withoutMarker(state.body);
  await Promise.all(others.map(async (run) => await updateRun(repo, run.id, mirror)));
}

/**
 * Append the remaining annotation batches to the run, one request after the other (in order); the
 * last carries the final output (with the finding-set hash), the others the interim one.
 */
async function appendBatches(
  repo: CheckRepo,
  id: number,
  rest: {
    output: { interim: CheckRunBody["output"]; final: CheckRunBody["output"] };
    batches: CheckAnnotation[][];
  },
): Promise<void> {
  const [next, ...later] = rest.batches;
  if (next === undefined) {
    return;
  }
  const output = later.length === 0 ? rest.output.final : rest.output.interim;
  await updateRun(repo, id, { output: { ...output, annotations: next } });
  await appendBatches(repo, id, { output: rest.output, batches: later });
}
