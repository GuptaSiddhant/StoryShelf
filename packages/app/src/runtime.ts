import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { AdapterMetadata, GitAdapterMetadata } from "@storyshelf/core/adapter/metadata";
import type { ShelfConfig, ShelfOptions, UIConfig } from "@storyshelf/core/config";
import { validateConfig, validateUiConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { createShelfLogger } from "@storyshelf/core/logger";

/**
 * Resolved server runtime derived from {@link ShelfOptions}.
 * Holds the validated config, UI branding, structured logger, and
 * computed helpers like whether auth is enabled and which git hosts are wired.
 */
export interface ServerRuntime {
  config: ShelfConfig;
  ui: UIConfig;
  logger: Logger;
  authEnabled: boolean;
  gitHosts: GitHostProvider[];
}

function addOptionalSnapshots(
  snap: Record<string, AdapterMetadata | GitAdapterMetadata>,
  options: ShelfOptions,
): void {
  if (options.captureRunner) {
    snap["captureRunner"] = options.captureRunner.metadata;
  }
  if (options.captureQueue) {
    snap["captureQueue"] = options.captureQueue.metadata;
  }
  if (options.auth) {
    snap["auth"] = options.auth.metadata;
    const maybeMulti = options.auth as unknown as {
      methods?: () => Array<{ id: string; adapter: { metadata: AdapterMetadata } }>;
    };
    if (typeof maybeMulti.methods === "function") {
      for (const method of maybeMulti.methods()) {
        snap[`auth:${method.id}`] = method.adapter.metadata;
      }
    }
  }
}

/**
 * Build a snapshot of adapter metadata for the `/api/v1/health` and docs.
 * Collects the name/version of every wired adapter so operators can verify
 * the running configuration at a glance.
 *
 * @param options - Router options containing the wired adapters
 * @returns Metadata map keyed by adapter category (e.g. `database`, `git:github`)
 */
export function buildAdapterSnapshot(
  options: ShelfOptions,
): Record<string, AdapterMetadata | GitAdapterMetadata> {
  const snap: Record<string, AdapterMetadata | GitAdapterMetadata> = {
    database: options.database.metadata,
    storage: options.storage.metadata,
  };
  addOptionalSnapshots(snap, options);
  for (const p of options.gitHosts ?? []) {
    snap[`git:${p.metadata.kind}`] = p.metadata;
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
  const gitHosts = options.gitHosts ?? [];
  // Adapter introspection — auto-populate config.adapters if not supplied
  const config: ShelfConfig = rawConfig.adapters
    ? rawConfig
    : {
        ...rawConfig,
        adapters: buildAdapterSnapshot(options),
      };
  return { config, ui, logger, authEnabled, gitHosts };
}
