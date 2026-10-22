import type { DesignProvider } from "@storyshelf/core/adapter/design";
import type { AdapterMetadata } from "@storyshelf/core/adapter/metadata";
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { ShelfConfig, ShelfOptions, UIConfig } from "@storyshelf/core/config";
import { validateConfig, validateUiConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { createShelfLogger } from "@storyshelf/core/logger";
import { createPublicOriginResolver, type PublicOriginResolver } from "@storyshelf/core/models";

/**
 * Resolved server runtime derived from {@link ShelfOptions}.
 * Holds the validated config, UI branding, structured logger, and
 * computed helpers like whether auth is enabled and which notifiers are wired.
 */
export interface ServerRuntime {
  config: ShelfConfig;
  ui: UIConfig;
  logger: Logger;
  authEnabled: boolean;
  design: DesignProvider[];
  notifiers: NotifierProvider[];
  /** The public origin for links built in the background (ADR 0007, decision 6). */
  publicOrigin: PublicOriginResolver;
}

function addOptionalSnapshots(snap: Record<string, AdapterMetadata>, options: ShelfOptions): void {
  if (options.testing?.runner) {
    snap["captureRunner"] = options.testing.runner.metadata;
  }
}

/**
 * Build a snapshot of adapter metadata for the `/api/v1/health` and docs.
 * Collects the name/version of every wired adapter so operators can verify
 * the running configuration at a glance.
 *
 * @param options - Router options containing the wired adapters
 * @returns Metadata map keyed by adapter category (e.g. `database`, `notify:github`)
 */
export function buildAdapterSnapshot(options: ShelfOptions): Record<string, AdapterMetadata> {
  const snap: Record<string, AdapterMetadata> = {
    database: options.database.metadata,
    storage: options.storage.metadata,
  };
  addOptionalSnapshots(snap, options);
  for (const p of options.design ?? []) {
    snap[`design:${p.metadata.kind}`] = p.metadata;
  }
  for (const n of options.notifications?.notifiers ?? []) {
    snap[`notify:${n.metadata.kind}`] = n.metadata;
  }
  return snap;
}

/** Validate config/ui and derive runtime singletons from options. */
export function resolveRuntime(options: ShelfOptions): ServerRuntime {
  // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- ShelfConfig lacks index signature
  const rawConfig = options.config
    ? validateConfig(options.config as unknown as Record<string, unknown>)
    : {};
  // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- UIConfig lacks index signature
  const ui = options.ui ? validateUiConfig(options.ui as unknown as Record<string, unknown>) : {};
  const logger = options.logger ?? createShelfLogger();
  const authEnabled = options.auth !== undefined;
  const design = options.design ?? [];
  const notifiers = options.notifications?.notifiers ?? [];
  // Adapter introspection — auto-populate config.adapters if not supplied
  const config: ShelfConfig = rawConfig.adapters
    ? rawConfig
    : {
        ...rawConfig,
        adapters: buildAdapterSnapshot(options),
      };
  const publicOrigin = createPublicOriginResolver({ db: options.database, config });
  return { config, ui, logger, authEnabled, design, notifiers, publicOrigin };
}
