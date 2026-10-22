/** What every stage of a sharded capture works against. */
import type { Logger } from "pino";
import type { CaptureTarget } from "../../adapters/capture-runner.ts";
import type { Build } from "../../schema/build.ts";
import type { Project } from "../../schema/project.ts";
import type { Viewport } from "../adapter.ts";
import type { MatrixInput } from "../matrix.ts";
import type { CaptureJobOptions } from "../orchestrator.ts";
import type { CaptureContext } from "../pipeline.ts";
import type { CaptureProgress } from "../progress.ts";
import { storybookUrlSource } from "../storybook-urls.ts";

/** The build being captured and the adapters to capture it with. */
export interface ShardTarget {
  options: CaptureJobOptions;
  build: Build;
  project: Project;
}

/** A capture context for the persist and finalize steps of one stage. */
export function contextOf(
  target: ShardTarget,
  parts: {
    viewports: Viewport[];
    browsers: CaptureTarget[];
    captures?: CaptureContext["captures"];
    inherited?: NonNullable<CaptureContext["inherited"]>;
    freshBrowsers?: ReadonlySet<string>;
    progress?: CaptureProgress | undefined;
  },
): CaptureContext {
  const { options } = target;
  return {
    db: options.db,
    tables: options.tables,
    storage: options.storage,
    project: target.project,
    build: target.build,
    viewports: parts.viewports,
    browsers: parts.browsers,
    captures: parts.captures ?? [],
    inherited: parts.inherited ?? [],
    ...(parts.freshBrowsers ? { freshBrowsers: parts.freshBrowsers } : {}),
    progress: parts.progress,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.secret ? { secret: options.secret } : {}),
  };
}

/** The matrix input for rendering `stories` from `storybookDir` on `browsers`. */
export function matrixInputOf(
  target: ShardTarget,
  parts: {
    stories: MatrixInput["stories"];
    viewports: Viewport[];
    browsers: CaptureTarget[];
    storybookDir: string;
    affectedPaths: string[] | null;
    logger?: Logger | undefined;
    recordLog?: MatrixInput["recordLog"];
    progress?: CaptureProgress | undefined;
    runId?: string | undefined;
  },
): MatrixInput {
  const { options } = target;
  return {
    db: options.db,
    storage: options.storage,
    tables: options.tables,
    runner: options.runner,
    build: target.build,
    project: target.project,
    stories: parts.stories,
    viewports: parts.viewports,
    storybookDir: parts.storybookDir,
    browsers: parts.browsers,
    affectedPaths: parts.affectedPaths,
    renderTimeoutMs: options.renderTimeoutMs,
    storybookUrl: storybookUrlSource(options, target),
    logger: parts.logger ?? options.logger,
    recordLog: parts.recordLog,
    progress: parts.progress,
    runId: parts.runId,
  };
}
