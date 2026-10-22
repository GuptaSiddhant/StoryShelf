/** Ask for a build's state to be shown on its project's git channels (ADR 0014, decision 5). */
import { createBuildStatePublisher, requestOpenBuildStates } from "@storyshelf/core/capture";
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
export async function requestBuildState(buildId: string): Promise<void> {
  const store = getStore();
  await (store.buildState ?? inlinePublisher(store)).request(buildId);
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
