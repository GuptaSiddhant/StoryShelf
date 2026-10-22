/** Dependencies and handles of build-state delivery (ADR 0014, decisions 5 and 7). */
import type { DatabaseAdapter } from "../../adapters/database.ts";
import type { BuildStateFlags } from "../../adapters/notifier/build-state.ts";
import type { NotifierProvider, StateNotifierProvider } from "../../adapters/notifier/provider.ts";
import type { NotificationChannel } from "../../adapters/notifier/types.ts";
import type { StorageAdapter } from "../../adapters/storage.ts";
import type { ShelfConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import type { Project } from "../../schema/project.ts";
import type { SecretInput } from "../../utils/encrypt.ts";

/** What delivering a build's state needs. */
export interface BuildStateDeps {
  db: DatabaseAdapter;
  /** Read to tell whether the build's Storybook is published; without it publishing reads as pending. */
  storage?: StorageAdapter | undefined;
  /** Notifier providers; only the `state` ones (git hosts) take part. */
  notifiers: readonly NotifierProvider[];
  /** Server secret that decrypts channel tokens. */
  secret: SecretInput;
  /** Absolute links come from `publicBaseUrl`; the published-Storybook domain from `publishedBaseDomain`. */
  config: Pick<ShelfConfig, "publicBaseUrl" | "publishedBaseDomain">;
  /**
   * The resolved public origin (ADR 0007, decision 6). Without it `config.publicBaseUrl` is used;
   * with neither, statuses carry no link and no pull-request comment is written.
   */
  publicOrigin?: (() => Promise<string | undefined>) | undefined;
  /** Which statuses a project's builds show: `testing` from the server options, review from the project. */
  flags: (project: Project) => BuildStateFlags;
  logger: Logger;
}

/** A channel with the provider that delivers to it. */
export interface StateTarget {
  channel: NotificationChannel;
  provider: StateNotifierProvider;
}

/** Why a delivery wrote nothing. */
export type SkipReason = "no-build" | "no-channel" | "disabled" | "no-provider";

/**
 * Asks for a build's current state to be shown on its project's git channels. Never rejects: the
 * request that triggered it must not fail because a git host did.
 */
export interface BuildStatePublisher {
  request(buildId: string): Promise<void>;
}
