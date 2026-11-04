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
  withoutMarker,
} from "./github-check-mapper.ts";

/** Coordinates and installation token of one repository. */
export interface CheckRepo {
  token: string;
  owner: string;
  repo: string;
  logger?: Logger | undefined;
}

export interface ExistingRun {
  id: number;
  external_id?: string | null;
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
