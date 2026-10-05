/**
 * Runtime side of secret rotation: boot check/migration, the health probe, and
 * the re-encrypt action shared by the System page and the admin API.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { ShelfConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import {
  probeCredentials,
  reencryptCredentials,
  type CredentialProbe,
  type ReencryptResult,
} from "@storyshelf/core/models";
import type { SecretKeys } from "@storyshelf/core/utils";
import type { LifecycleCell } from "./lifecycle.ts";

/** Current/previous key pair for a probe, or null when no secret is configured. */
export function secretKeysOf(config: ShelfConfig): SecretKeys | null {
  if (!config.secret) {
    return null;
  }
  return config.previousSecret
    ? { current: config.secret, previous: config.previousSecret }
    : { current: config.secret };
}

/** Probe stored credentials; null when no secret is configured. */
export async function loadCredentialProbe(
  db: DatabaseAdapter,
  config: ShelfConfig,
): Promise<CredentialProbe | null> {
  const keys = secretKeysOf(config);
  return keys ? await probeCredentials(db, keys) : null;
}

/** Re-encrypt rows under `previousSecret`; throws when no rotation is configured. */
export async function reencryptWithCurrent(
  db: DatabaseAdapter,
  config: ShelfConfig,
): Promise<ReencryptResult> {
  const keys = secretKeysOf(config);
  if (!keys?.previous) {
    throw new Error("No previousSecret is configured; nothing to re-encrypt");
  }
  return await reencryptCredentials(db, keys);
}

/** Log what the probe found; returns whether rows still need re-encryption. */
function logProbe(probe: CredentialProbe, config: ShelfConfig, logger: Logger): boolean {
  if (config.migrateCredentialsOnBoot && !config.previousSecret) {
    logger.warn("migrateCredentialsOnBoot has no effect without previousSecret");
  }
  if (probe.unreadable.length > 0) {
    logger.error(
      { count: probe.unreadable.length, rows: probe.unreadable.slice(0, 20) },
      "stored credentials cannot be decrypted; check SECRET and SECRET_PREVIOUS",
    );
  }
  if (probe.previous > 0 && !config.migrateCredentialsOnBoot) {
    logger.warn(
      { count: probe.previous },
      "credentials still encrypted with previousSecret; re-encrypt from the System page",
    );
  }
  return probe.previous > 0;
}

/** Log the credential state at boot and, if opted in, migrate to the current key. */
export async function checkCredentialsAtBoot(
  db: DatabaseAdapter,
  config: ShelfConfig,
  logger: Logger,
): Promise<void> {
  const probe = await loadCredentialProbe(db, config);
  if (!probe || !logProbe(probe, config, logger) || !config.migrateCredentialsOnBoot) {
    return;
  }
  const result = await reencryptWithCurrent(db, config);
  logger.info(
    { reencrypted: result.reencrypted, failed: result.failed },
    "re-encrypted credentials with the current secret",
  );
}

/** Run {@link checkCredentialsAtBoot} once adapters are ready; never blocks or throws. */
export function checkCredentialsAfterSetup(
  cell: LifecycleCell,
  db: DatabaseAdapter,
  config: ShelfConfig,
  logger: Logger,
): void {
  cell.ready
    .then(async (setup) => {
      if (setup.ok) {
        await checkCredentialsAtBoot(db, config, logger);
      }
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, "credential check failed");
    });
}
