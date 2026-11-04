/** Request-side insight orchestration: evidence, hash, cache check, budget, spawn. */
import {
  HEALTH_SYSTEM,
  PROMPT_VERSION,
  TRIAGE_SYSTEM,
  computeInputHash,
  healthEnvelopeSchema,
  triageEnvelopeSchema,
  type BuiltEvidence,
} from "@storyshelf/core/insights";
import { AiUsageModel, InsightModel, type InsightStartInput } from "@storyshelf/core/models";
import type { Build, InsightRow, Project } from "@storyshelf/core/schema";
import { createHash } from "node:crypto";
import { reserveBudget } from "./budget.ts";
import type { InsightDeps } from "./deps.ts";
import { spawnJob } from "./job.ts";
import { loadHealthEvidence, parseWindow } from "./load-health.ts";
import { loadTriageEvidence } from "./load-triage.ts";

/** Outcome of a request: the row and whether it was already finished (200) or queued (202). */
export interface RequestOutcome {
  row: InsightRow;
  status: 200 | 202;
}

/** Options for starting a run. */
export interface RunOptions {
  force: boolean;
  /** Profile override (honoured only for site admins by the router). */
  profile?: string | undefined;
}

/** The profile a project uses: override, else its gate value (`default` = default profile). */
export function profileFor(deps: InsightDeps, project: Project, override?: string): string {
  const wanted = override ?? project.aiProfile ?? "default";
  const names = deps.ai.profileNames();
  if (names.includes(wanted)) {
    return wanted;
  }
  return deps.ai.defaultProfile();
}

function digest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Budget applies only when a new run would start (cache hits and in-flight rows are free): one
 * call is reserved for it, whose id is returned (null when nothing was reserved).
 */
async function guardBudget(
  deps: InsightDeps,
  input: InsightStartInput,
  existing: InsightRow | null,
): Promise<string | null> {
  const inFlight = existing?.status === "pending" || existing?.status === "running";
  if (inFlight) {
    return null;
  }
  return await reserveBudget(deps, {
    projectId: input.projectId,
    profile: input.profile,
    task: input.kind,
    model: input.model,
  });
}

/** Tie a reservation to the insight that will use it, or give it back when nothing will run. */
async function settleReservation(
  usage: AiUsageModel,
  reservation: string,
  started: { row: InsightRow; run: boolean },
): Promise<void> {
  await (started.run ? usage.attach(reservation, started.row.id) : usage.release(reservation));
}

/** Undo a failed start: give the reservation back and do not leave a runnable insight pending. */
async function undoStart(
  deps: InsightDeps,
  reservation: string | null,
  started: { row: InsightRow; run: boolean } | null,
): Promise<void> {
  if (reservation !== null) {
    await new AiUsageModel(deps.db).release(reservation).catch(() => null);
  }
  if (started?.run === true) {
    // Nothing will run it: later requests would otherwise wait on it.
    await new InsightModel(deps.db).markFailed(started.row.id, "interrupted").catch(() => null);
  }
}

/** Start the insight the reservation is for; the reservation follows the insight or is given back. */
async function startReserved(
  deps: InsightDeps,
  input: InsightStartInput,
  reservation: string | null,
): Promise<{ row: InsightRow; run: boolean }> {
  let held = reservation;
  let started: { row: InsightRow; run: boolean } | null = null;
  try {
    started = await new InsightModel(deps.db).start(input);
    // An in-flight row seen earlier may have ended before `start`: that run still needs admission.
    held ??= started.run ? await guardBudget(deps, input, null) : null;
    if (held !== null) {
      await settleReservation(new AiUsageModel(deps.db), held, started);
    }
    return started;
  } catch (error) {
    await undoStart(deps, held, started);
    throw error;
  }
}

async function launch(
  deps: InsightDeps,
  input: InsightStartInput,
  begin: (row: InsightRow) => void,
): Promise<RequestOutcome> {
  const model = new InsightModel(deps.db);
  const existing = await model.peek(input);
  if (existing?.status === "done" && existing.inputHash === input.inputHash && !input.force) {
    return { row: existing, status: 200 };
  }
  const reservation = await guardBudget(deps, input, existing);
  const { row, run } = await startReserved(deps, input, reservation);
  if (run) {
    begin(row);
  }
  return { row, status: row.status === "done" ? 200 : 202 };
}

/** Build the base `InsightStartInput` shared by both kinds. */
function baseInput(
  deps: InsightDeps,
  project: Project,
  profile: string,
  task: "triage" | "health",
  evidence: BuiltEvidence,
  images: Uint8Array[],
): Pick<InsightStartInput, "inputHash" | "profile" | "model" | "promptVersion" | "projectId"> {
  const model = deps.ai.modelId(profile, task, images.length > 0);
  return {
    projectId: project.id,
    profile,
    model,
    promptVersion: PROMPT_VERSION,
    inputHash: computeInputHash({
      evidenceText: evidence.text,
      imageDigests: images.map((data) => digest(data)),
      promptVersion: PROMPT_VERSION,
      task,
      profile,
      model,
    }),
  };
}

/** Request (or fetch the cached) triage insight for a build. */
export async function requestTriage(
  deps: InsightDeps,
  project: Project,
  build: Build,
  options: RunOptions,
): Promise<RequestOutcome> {
  const profile = profileFor(deps, project, options.profile);
  const loaded = await loadTriageEvidence(deps, project, build);
  const vision = deps.ai.hasVision(profile, "triage");
  const evidence = { ...loaded, images: vision ? loaded.images : [] };
  const input: InsightStartInput = {
    ...baseInput(
      deps,
      project,
      profile,
      "triage",
      evidence,
      evidence.images.map((i) => i.data),
    ),
    buildId: build.id,
    kind: "triage",
    windowKey: null,
    force: options.force,
  };
  return await launch(deps, input, (row) => {
    spawnJob(deps, row, {
      task: "triage",
      system: TRIAGE_SYSTEM,
      evidence,
      schema: triageEnvelopeSchema,
      profileRequested: options.profile ?? project.aiProfile ?? null,
      project,
      reviewSuffix: `/builds/${build.id}`,
    });
  });
}

/** Request (or fetch the cached) project-health insight for a window like `30d`. */
export async function requestHealth(
  deps: InsightDeps,
  project: Project,
  window: string,
  options: RunOptions,
): Promise<RequestOutcome | null> {
  const days = parseWindow(window);
  if (days === null) {
    return null;
  }
  const profile = profileFor(deps, project, options.profile);
  const evidence = await loadHealthEvidence(deps, project, window, days);
  const input: InsightStartInput = {
    ...baseInput(deps, project, profile, "health", evidence, []),
    buildId: null,
    kind: "health",
    windowKey: window,
    force: options.force,
  };
  return await launch(deps, input, (row) => {
    spawnJob(deps, row, {
      task: "health",
      system: HEALTH_SYSTEM,
      evidence,
      schema: healthEnvelopeSchema,
      profileRequested: options.profile ?? project.aiProfile ?? null,
      project,
      reviewSuffix: "",
    });
  });
}
