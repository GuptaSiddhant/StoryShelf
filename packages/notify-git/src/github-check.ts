import type { Logger } from "@storyshelf/core/logger";
import { httpJson } from "@storyshelf/core/utils";
import { githubHeaders, repoPath } from "./github-api.ts";
import {
  annotationBatches,
  checkRunBody,
  externalIdOf,
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
  output?: { annotations_count?: number | null } | null;
}

/**
 * Show a status as a check run of the commit `sha`: update the run that carries the status's
 * `external_id`, or create it, so a build has one run per name and its lifecycle (queued,
 * in progress, completed) moves that run. The annotations follow in batches of 50; the ones
 * already on the run are skipped, so posting the same state again adds nothing.
 */
export async function postCheckRun(
  repo: CheckRepo,
  input: CheckRunInput & { sha: string },
): Promise<void> {
  const body = checkRunBody(input);
  const existing = await findRun(repo, input);
  const batches = annotationBatches(
    input.annotations ?? [],
    existing?.output?.annotations_count ?? 0,
  );
  repo.logger?.debug(
    { context: input.context, sha: input.sha, status: body.status },
    "posting check run",
  );
  try {
    const run = existing
      ? await update(repo, existing.id, withBatch(body, batches[0]))
      : await create(repo, { ...withBatch(body, batches[0]), head_sha: input.sha });
    await appendBatches(repo, run.id, { output: body.output, batches: batches.slice(1) });
  } catch (error) {
    repo.logger?.error(
      { err: error, context: input.context, sha: input.sha },
      "failed to post check run",
    );
    throw error;
  }
}

type WithAnnotations = Omit<CheckRunBody, "output"> & {
  output: CheckRunBody["output"] & { annotations?: CheckAnnotation[] };
};

function withBatch(body: CheckRunBody, batch: CheckAnnotation[] | undefined): WithAnnotations {
  return batch === undefined ? body : { ...body, output: { ...body.output, annotations: batch } };
}

/** The run of this commit that carries the status's `external_id`, if there is one. */
async function findRun(
  repo: CheckRepo,
  input: { sha: string; context: string },
): Promise<ExistingRun | undefined> {
  const url = repoPath(
    repo.owner,
    repo.repo,
    `/commits/${encodeURIComponent(input.sha)}/check-runs?filter=latest&per_page=100&check_name=${encodeURIComponent(input.context)}`,
  );
  const listed = await httpJson<{ check_runs?: ExistingRun[] }>(url, {
    headers: githubHeaders(repo.token),
  });
  return listed.check_runs?.find((run) => run.external_id === externalIdOf(input.context));
}

async function create(repo: CheckRepo, body: unknown): Promise<{ id: number }> {
  return await httpJson<{ id: number }>(repoPath(repo.owner, repo.repo, "/check-runs"), {
    method: "POST",
    headers: githubHeaders(repo.token),
    json: body,
    logger: repo.logger,
  });
}

async function update(repo: CheckRepo, id: number, body: unknown): Promise<{ id: number }> {
  return await httpJson<{ id: number }>(
    repoPath(repo.owner, repo.repo, `/check-runs/${String(id)}`),
    {
      method: "PATCH",
      headers: githubHeaders(repo.token),
      json: body,
      logger: repo.logger,
    },
  );
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
  await update(repo, id, { output: { ...rest.output, annotations: next } });
  await appendBatches(repo, id, { output: rest.output, batches: later });
}
