/** Ask for a build's state to be shown on its project's git channels (ADR 0014, decision 5). */
import {
  createBuildStatePublisher,
  requestOpenBuildStates,
  tryRequestOpenBuildStates,
  type OpenBuildRequest,
} from "@storyshelf/core/capture";
import { BuildModel } from "@storyshelf/core/models";
import { buildStateFlags } from "./build-state-flags.ts";
import { credentialKeys } from "./credential-keys.ts";
import { notificationOrigin } from "./notifications-pause.ts";
import { getStore, type Store } from "./store.ts";

/**
 * Show the build's current state (commit statuses and the pull-request comment) on every git
 * channel of its project. Called on every transition a request causes: build creation, a review
 * outcome, a retry. Delivery reads the build when it runs, so the call needs no state of its own;
 * it never rejects, so a git host cannot fail the action that triggered it.
 */
export async function requestBuildState(
  buildId: string,
  only?: { channelId?: string },
): Promise<void> {
  const store = getStore();
  const publisher = store.buildState ?? inlinePublisher(store);
  await publisher.request(buildId, only);
  await requestSkippedFollowers(store, publisher, buildId, only);
}

/**
 * A skipped build follows its source (ADR 0044, decision 6): whenever the source's state is asked
 * for (a verdict moved it, a retry reset it), the builds skipped from it are asked for too, so a
 * rejected source never leaves a green check on a newer commit. This is the one place that does it:
 * every call site of {@link requestBuildState} gets it. A lookup that fails is logged, not thrown.
 */
async function requestSkippedFollowers(
  store: Store,
  publisher: ReturnType<typeof createBuildStatePublisher>,
  buildId: string,
  only?: { channelId?: string },
): Promise<void> {
  try {
    const followers = await new BuildModel(store.db).skippedFrom(buildId);
    await Promise.all(
      followers.map(async (build) => {
        await publisher.request(build.id, only);
      }),
    );
  } catch (err) {
    store.logger.warn(
      { err, buildId },
      "could not request the state of the builds skipped from it",
    );
  }
}

/**
 * An operator's "retry current state" for one git channel: ask again for the open builds of its
 * project, to that channel only. Resolves to how many builds were asked, or `{ ok: false }` when
 * the lookup of open builds failed (logged once); never rejects. Callers check for a confirmed
 * origin first, since without one nothing is delivered.
 */
export async function requestChannelStateNow(scope: {
  projectId: string;
  channelId: string;
}): Promise<OpenBuildRequest> {
  return await tryRequestOpenBuildStates(getStore(), { request: requestBuildState }, scope);
}

/**
 * An origin just became resolved (an admin confirmed or reported one): requests made while none was
 * were dropped, so ask again for the builds that can still change (ADR 0014, decision 11).
 * Resolves to how many builds were asked; never rejects.
 */
export async function requestOpenBuildStatesNow(): Promise<number> {
  const store = getStore();
  return await requestOpenBuildStates(store, { request: requestBuildState });
}

/** Hand-built stores have no wiring: deliver inline through the store's own adapters. */
function inlinePublisher(store: Store): ReturnType<typeof createBuildStatePublisher> {
  return createBuildStatePublisher({
    deps: {
      db: store.db,
      storage: store.storage,
      notifiers: store.notifiers,
      secret: credentialKeys(store.config),
      config: store.config,
      publicOrigin: async () => await notificationOrigin(store),
      flags: (project) => buildStateFlags(store.testing, project),
      logger: store.logger,
    },
  });
}
