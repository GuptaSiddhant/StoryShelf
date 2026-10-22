/**
 * Publishing's end: apply {@link publishVerdict} to the build and run the `afterPublish` hooks.
 * Every publish route (inline zip, `publish` job, file-by-file manifest) ends here, so this is the
 * single owner of the acceptance rule.
 */
import type { DatabaseAdapter } from "../../adapters/database.ts";
import type { Logger } from "../../logger.ts";
import { BuildModel } from "../../models/build.ts";
import { ProjectModel } from "../../models/project.ts";
import type { Build } from "../../schema/build.ts";
import type { Project } from "../../schema/project.ts";
import { publishVerdict } from "./accept.ts";

/** How publishing ended. */
export type PublishOutcome = { ok: true } | { ok: false; error: string };

/** What an `afterPublish` hook is given. */
export interface AfterPublishContext {
  /** The build as it is after the verdict was applied. */
  build: Build;
  project: Project;
  outcome: PublishOutcome;
  logger: Logger;
}

/** Runs once per finished publish (extension point of the catalog). Failures are logged, never thrown on. */
export type AfterPublishHook = (context: AfterPublishContext) => Promise<void>;

/** Finishes a build's publishing. */
export interface PublishCompleter {
  /**
   * Record the end of a build's publishing. Resolves to the build, or null when it is gone.
   * Safe to repeat: a build that left `pending` keeps its status.
   */
  complete(buildId: string, outcome: PublishOutcome): Promise<Build | null>;
}

/** What {@link createPublishCompleter} needs. */
export interface PublishCompleterOptions {
  db: DatabaseAdapter;
  /** Whether a capture runs for uploads (`testing`); capture then owns the build status. */
  captureWillRun: boolean;
  /** Hooks, read on every call so later registrations count. */
  afterPublish: readonly AfterPublishHook[];
  logger: Logger;
}

/** A completer over `options.db`. */
export function createPublishCompleter(options: PublishCompleterOptions): PublishCompleter {
  return {
    complete: async (buildId, outcome) => {
      const target = await load(options.db, buildId);
      if (!target) {
        options.logger.warn({ buildId }, "build is gone; nothing to complete");
        return null;
      }
      const build = await applyVerdict(options, target.build, target.project, outcome);
      await runHooks(options, { build, project: target.project, outcome });
      return build;
    },
  };
}

async function load(
  db: DatabaseAdapter,
  buildId: string,
): Promise<{ build: Build; project: Project } | null> {
  const build = await new BuildModel(db).get(buildId);
  const project = build ? await new ProjectModel(db).get(build.projectId) : null;
  return build && project ? { build, project } : null;
}

/** Move the build per the rule. No approval event or webhook: `build:created` announced the upload. */
async function applyVerdict(
  options: PublishCompleterOptions,
  build: Build,
  project: Project,
  outcome: PublishOutcome,
): Promise<Build> {
  const verdict = publishVerdict({
    published: outcome.ok,
    captureWillRun: options.captureWillRun,
    defaultBranch: build.gitBranch === project.gitDefaultBranch,
    status: build.status,
  });
  if (!outcome.ok) {
    options.logger.error({ buildId: build.id, error: outcome.error, verdict }, "publish failed");
  }
  if (verdict === "unchanged") {
    return build;
  }
  return await new BuildModel(options.db).setStatus(build.id, verdict);
}

async function runHooks(
  options: PublishCompleterOptions,
  context: Omit<AfterPublishContext, "logger">,
): Promise<void> {
  const logger = options.logger.child({ buildId: context.build.id });
  for (const hook of options.afterPublish) {
    try {
      // eslint-disable-next-line no-await-in-loop -- hooks run in registration order
      await hook({ ...context, logger });
    } catch (error) {
      logger.error({ err: error }, "afterPublish hook failed");
    }
  }
}
