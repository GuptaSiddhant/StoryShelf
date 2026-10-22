/**
 * Delivering a build's state to git channels: read the build now, compute what each channel shows
 * ({@link statusesForBuild}), write it. Reading at delivery time is what makes a retried, delayed
 * or reordered request harmless (ADR 0014, decision 7).
 */
import {
  channelPrefix,
  statusesForBuild,
  writeBuildState,
  type PublishingState,
} from "../../adapters/notifier/index.ts";
import { isStateProvider } from "../../adapters/notifier/provider.ts";
import { BuildModel } from "../../models/build.ts";
import { NotificationChannelModel } from "../../models/notification-channel.ts";
import { ProjectModel } from "../../models/project.ts";
import type { Build } from "../../schema/build.ts";
import type { Project } from "../../schema/project.ts";
import { createUrlBuilder } from "../../urls.ts";
import { storybookDir } from "../../utils/paths.ts";
import type { BuildStateDeps, SkipReason, StateTarget } from "./types.ts";

/**
 * Show the build's current state on one channel. Throws when the host refuses a status, so the
 * caller can retry; resolves to why nothing was written when the build or channel is gone.
 */
export async function deliverBuildState(
  deps: BuildStateDeps,
  ids: { buildId: string; channelId: string },
): Promise<"delivered" | SkipReason> {
  const loaded = await loadBuild(deps, ids.buildId);
  if (loaded === null) {
    return "no-build";
  }
  const target = await loadTarget(deps, ids.channelId, loaded.project.id);
  if (typeof target === "string") {
    return target;
  }
  await writeTo(deps, loaded, target);
  return "delivered";
}

/** The build and its project, or null when either is gone. */
export async function loadBuild(
  deps: BuildStateDeps,
  buildId: string,
): Promise<{ build: Build; project: Project } | null> {
  const build = await new BuildModel(deps.db).get(buildId);
  const project = build ? await new ProjectModel(deps.db).get(build.projectId) : null;
  return build && project ? { build, project } : null;
}

/** Write `target`'s view of the build; throws on a refused status. */
export async function writeTo(
  deps: BuildStateDeps,
  loaded: { build: Build; project: Project },
  target: StateTarget,
): Promise<void> {
  const { build, project } = loaded;
  const states = statusesForBuild({
    build,
    projectSlug: project.slug,
    prefix: channelPrefix(target.channel),
    urls: createUrlBuilder(deps.config.publicBaseUrl ?? "", deps.config.publishedBaseDomain),
    flags: deps.flags(project),
    publishing: await publishingOf(deps, build),
  });
  if (states.statuses.length === 0) {
    deps.logger.info({ buildId: build.id }, "no commit to show a state on");
    return;
  }
  await writeBuildState(target.provider, target.channel, {
    sha: build.gitSha,
    states,
    logger: deps.logger,
  });
}

/** The project's enabled channels with a wired `state` provider; unreadable secrets are logged and skipped. */
export async function stateTargets(
  deps: BuildStateDeps,
  projectId: string,
): Promise<StateTarget[]> {
  const model = channelModel(deps);
  const rows = await model.list(projectId);
  return rows.flatMap((row) => {
    const view = row.enabled ? model.toView(row) : null;
    if (row.enabled && view === null) {
      deps.logger.warn(
        { channelId: row.id, provider: row.provider },
        "failed to decrypt channel secret",
      );
    }
    return view === null ? [] : targetOf(deps, view);
  });
}

/** One channel by id, or why it cannot take part. */
async function loadTarget(
  deps: BuildStateDeps,
  channelId: string,
  projectId: string,
): Promise<StateTarget | Extract<SkipReason, "no-channel" | "disabled" | "no-provider">> {
  const model = channelModel(deps);
  const row = await model.get(channelId);
  if (row === null || row.projectId !== projectId) {
    return "no-channel";
  }
  if (!row.enabled) {
    return "disabled";
  }
  const view = model.toView(row);
  if (view === null) {
    throw new Error("channel secret cannot be decrypted with the configured keys");
  }
  return targetOf(deps, view)[0] ?? "no-provider";
}

function targetOf(deps: BuildStateDeps, channel: StateTarget["channel"]): StateTarget[] {
  const provider = deps.notifiers.find((candidate) => candidate.metadata.kind === channel.provider);
  return provider !== undefined && isStateProvider(provider) ? [{ channel, provider }] : [];
}

function channelModel(deps: BuildStateDeps): NotificationChannelModel {
  return new NotificationChannelModel(
    deps.db,
    { notificationChannels: deps.db.tables.notificationChannels },
    deps.secret,
  );
}

/**
 * Whether the build's Storybook is published: its manifest is written last, so its presence means
 * done. A `failed` build without one failed to publish (or never uploaded); any other build waits.
 */
async function publishingOf(deps: BuildStateDeps, build: Build): Promise<PublishingState> {
  const published =
    deps.storage !== undefined &&
    (await deps.storage.exists(`${storybookDir(build.projectId, build.id)}/manifest.json`));
  if (published) {
    return "success";
  }
  return build.status === "failed" ? "failure" : "pending";
}
