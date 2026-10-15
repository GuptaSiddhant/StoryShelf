import type { OAuthConnectable } from "@storyshelf/core/adapter/oauth";
import { ConnectionModel } from "@storyshelf/core/models";
import { credentialKeys } from "./credential-keys.ts";
import { getStore } from "./store.ts";

/**
 * Services a user can connect their own account to. Today only design providers
 * offer OAuth; a future issue-tracker or notifier adapter that exposes
 * `oauth` joins by being listed here — routes, state signing, storage and
 * refresh are shared.
 */
export function connectableServices(): OAuthConnectable[] {
  return [...getStore().design];
}

/** A connectable service whose operator configured OAuth. */
export type Connectable = Required<OAuthConnectable>;

/** The service addressed by `kind` when the operator configured OAuth for it, else undefined. */
export function findConnectable(kind: string): Connectable | undefined {
  const found = connectableServices().find(
    (service) => service.metadata.kind === kind && service.oauth,
  );
  return found as Connectable | undefined;
}

/** Connection storage bound to the server's credential keys. */
export function connectionModel(): ConnectionModel {
  const { db, config } = getStore();
  return new ConnectionModel(db, credentialKeys(config));
}

/** Connecting needs authentication (a user to own it) and a server secret (to sign the flow). */
export function canConnect(): boolean {
  const { authEnabled, user, config } = getStore();
  return authEnabled && Boolean(user) && Boolean(config.secret);
}
