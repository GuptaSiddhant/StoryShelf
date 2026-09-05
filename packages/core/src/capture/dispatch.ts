import type { DatabaseAdapter } from "../adapters/database.ts";
import type { GitHostProvider } from "../adapters/git-host/index.ts";
import type { Logger } from "../logger.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { executeCaptureJob, type CaptureJobOptions } from "./orchestrator.ts";
import { hasApprovedBuildForSha, isAlreadyMerged } from "./skip-checks.ts";
import { postStatusesForBuild } from "./status-fanout.ts";

/** Dependencies for building the capture queue's job runner. */
export interface DispatchDeps {
  db: DatabaseAdapter;
  jobOptions: CaptureJobOptions;
  gitHosts: GitHostProvider[];
  secret: string | undefined;
  logger: Logger;
}

/** A queued capture job. */
export interface CaptureDispatchJob {
  buildId: string;
  reqId?: string;
}

interface JobContext {
  deps: DispatchDeps;
  build: Build;
  project: Project;
  pendingUrl: string;
}

async function postPending(
  deps: DispatchDeps,
  project: Project,
  url: string,
  sha: string,
): Promise<void> {
  await postStatusesForBuild({
    db: deps.db,
    project,
    sha,
    status: "pending",
    url,
    providers: deps.gitHosts,
    secret: deps.secret,
    logger: deps.logger,
  }).catch((error: unknown) => {
    deps.logger.error({ err: error }, "failed to post pending status");
  });
}

async function postTerminal(
  deps: DispatchDeps,
  project: Project,
  url: string,
  sha: string,
  status: "success" | "failure",
): Promise<void> {
  await postStatusesForBuild({
    db: deps.db,
    project,
    sha,
    status,
    url,
    providers: deps.gitHosts,
    secret: deps.secret,
    logger: deps.logger,
  }).catch((error: unknown) => {
    deps.logger.error({ err: error }, "failed to post terminal status");
  });
}

async function approveWithoutCapture(ctx: JobContext, reason: string): Promise<void> {
  const { deps, build, project, pendingUrl } = ctx;
  deps.logger.info({ buildId: build.id, sha: build.gitSha, branch: build.gitBranch }, reason);
  await new BuildModel(deps.db).setStatus(build.id, "approved").catch(() => {}); // Intentionally empty — fire-and-forget
  await postTerminal(deps, project, pendingUrl, build.gitSha, "success").catch(() => {}); // Intentionally empty — fire-and-forget
}

async function maybeSkipMerged(ctx: JobContext): Promise<boolean> {
  const { deps, build, project } = ctx;
  if (build.isDefault) {
    return false;
  }
  const merged = await isAlreadyMerged({
    providers: deps.gitHosts,
    sha: build.gitSha,
    branch: build.gitBranch,
    secret: deps.secret,
    db: deps.db,
    projectId: project.id,
    logger: deps.logger,
  }).catch(() => false);
  if (merged) {
    await approveWithoutCapture(ctx, "skipping capture — already merged");
    return true;
  }
  return false;
}

async function maybeSkipDuplicate(ctx: JobContext): Promise<boolean> {
  const { deps, build, project } = ctx;
  const dup = await hasApprovedBuildForSha(deps.db, project.id, build.gitSha, build.id);
  if (dup) {
    await approveWithoutCapture(ctx, "skipping capture — duplicate sha already approved");
    return true;
  }
  return false;
}

/** Map a terminal build status to its check-run state. */
function terminalState(status: string | undefined): "success" | "failure" | null {
  if (status === "approved") {
    return "success";
  }
  if (status === "rejected" || status === "failed") {
    return "failure";
  }
  return null;
}

/** Post the terminal status for a finished capture. */
async function reportTerminalStatus(ctx: JobContext, buildId: string): Promise<void> {
  const { deps, build, project, pendingUrl } = ctx;
  const updated = await new BuildModel(deps.db).get(buildId);
  const terminal = terminalState(updated?.status);
  if (terminal) {
    await postTerminal(deps, project, pendingUrl, build.gitSha, terminal);
  }
}

async function runAndReport(ctx: JobContext, job: CaptureDispatchJob): Promise<void> {
  const { deps, build, project, pendingUrl } = ctx;
  try {
    await executeCaptureJob({ buildId: job.buildId, reqId: job.reqId }, deps.jobOptions);
    await reportTerminalStatus(ctx, job.buildId);
  } catch (error: unknown) {
    await postStatusesForBuild({
      db: deps.db,
      project,
      sha: build.gitSha,
      status: "failure",
      url: pendingUrl,
      providers: deps.gitHosts,
      secret: deps.secret,
      logger: deps.logger,
    }).catch(() => {
      // Ignore: status post failure already logged
    });
    throw error;
  }
}

/** Load the build + project for a job, running orphan jobs directly. */
async function loadJobTarget(
  deps: DispatchDeps,
  job: CaptureDispatchJob,
): Promise<{ build: Build; project: Project } | null> {
  const builds = new BuildModel(deps.db);
  const build = await builds.get(job.buildId);
  if (!build) {
    await executeCaptureJob({ buildId: job.buildId, reqId: job.reqId }, deps.jobOptions);
    return null;
  }
  const project = await new ProjectModel(deps.db).get(build.projectId);
  if (!project) {
    await executeCaptureJob({ buildId: job.buildId, reqId: job.reqId }, deps.jobOptions);
    return null;
  }
  return { build, project };
}

/** Build the queue's job runner: post pending, apply skip rules, capture, report. */
export function createDispatchJob(deps: DispatchDeps): (job: CaptureDispatchJob) => Promise<void> {
  return async (job: CaptureDispatchJob): Promise<void> => {
    const target = await loadJobTarget(deps, job);
    if (!target) {
      return;
    }
    const pendingUrl = `/projects/${target.project.slug}/builds/${job.buildId}`;
    await postPending(deps, target.project, pendingUrl, target.build.gitSha);
    const ctx: JobContext = { deps, build: target.build, project: target.project, pendingUrl };
    if ((await maybeSkipMerged(ctx)) || (await maybeSkipDuplicate(ctx))) {
      return;
    }
    await runAndReport(ctx, job);
  };
}
