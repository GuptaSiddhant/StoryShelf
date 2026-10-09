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
import { InsightModel, type InsightStartInput } from "@storyshelf/core/models";
import type { Build, InsightRow, Project } from "@storyshelf/core/schema";
import { createHash } from "node:crypto";
import { assertWithinBudget } from "./budget.ts";
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

/** Budget applies only when a new run would start (cache hits and in-flight rows are free). */
async function guardBudget(
  deps: InsightDeps,
  input: InsightStartInput,
  existing: InsightRow | null,
): Promise<void> {
  const inFlight = existing?.status === "pending" || existing?.status === "running";
  if (!inFlight) {
    await assertWithinBudget(deps, input.projectId);
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
  await guardBudget(deps, input, existing);
  const { row, run } = await model.start(input);
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
  const model = deps.ai.modelId(profile, task);
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
