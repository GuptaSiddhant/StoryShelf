import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
/**
 * The boot check of read-only shared accounts (#1274): a configured email that matches no user is
 * fail-open (a typo leaves the real account writable), so each one is reported once at boot,
 * without the address, which may be published.
 */
import type { Auth } from "@storyshelf/core/auth";
import type { Logger } from "@storyshelf/core/logger";
import { UserModel } from "@storyshelf/core/models";
import { trackBackground, type LifecycleCell } from "./lifecycle.ts";

/**
 * Warn once for each configured read-only account that has no user row, by its position in the
 * list (1-based) and never by its address. Returns how many were missing.
 */
export async function warnMissingReadOnlyAccounts(
  auth: Pick<Auth, "readOnlyAccounts"> | undefined,
  db: DatabaseAdapter,
  logger: Logger,
): Promise<number> {
  const accounts = auth?.readOnlyAccounts?.() ?? [];
  const users = new UserModel(db);
  const found = await Promise.all(accounts.map(async (email) => await users.getByEmail(email)));
  const missing = found.flatMap((user, index) => (user ? [] : [index + 1]));
  for (const position of missing) {
    logger.warn(
      { position, configured: accounts.length },
      "a read-only account has no user: it is not protected until an account with that email exists",
    );
  }
  return missing.length;
}

/** Run {@link warnMissingReadOnlyAccounts} once adapters (and so migrations) are ready; never rejects. */
export function warnMissingReadOnlyAccountsAfterSetup(
  cell: LifecycleCell,
  auth: Pick<Auth, "readOnlyAccounts"> | undefined,
  db: DatabaseAdapter,
  logger: Logger,
): void {
  if ((auth?.readOnlyAccounts?.() ?? []).length === 0) {
    return;
  }
  trackBackground(
    cell,
    cell.ready
      .then(async (setup) => {
        if (setup.ok) {
          await warnMissingReadOnlyAccounts(auth, db, logger);
        }
      })
      .catch((error: unknown) => {
        logger.warn({ err: error }, "could not check the read-only accounts");
      }),
  );
}
