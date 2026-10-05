/**
 * Stored-credential inventory and re-encryption for secret rotation.
 *
 * Webhook secrets, git-provider tokens, and notification-channel secrets are
 * encrypted under `ShelfConfig.secret`. After a rotation the old secret stays
 * available as `previousSecret` (decrypt-only); {@link probeCredentials} reports
 * which key each row needs and {@link reencryptCredentials} moves rows to the
 * current key. Neither returns or logs credential values.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import { decryptWithKey, encrypt, type SecretKeys } from "../utils/encrypt.ts";

/** Tables that hold encrypted credentials, with the column to read. */
const SOURCES = [
  { name: "webhooks", table: "webhooks", column: "secretEncrypted" },
  { name: "git status tokens", table: "projectStatusConfigs", column: "tokenEncrypted" },
  { name: "notification channels", table: "notificationChannels", column: "secretEncrypted" },
] as const;

/** A row no configured key can decrypt. */
export interface UnreadableCredential {
  source: string;
  id: string;
}

/** Which key each stored credential needs. */
export interface CredentialProbe {
  total: number;
  /** Rows readable with the current secret. */
  current: number;
  /** Rows only readable with `previousSecret`; run re-encryption. */
  previous: number;
  unreadable: UnreadableCredential[];
}

/** Outcome of {@link reencryptCredentials}. */
export interface ReencryptResult {
  reencrypted: number;
  failed: number;
  unreadable: UnreadableCredential[];
}

interface StoredCredential {
  source: (typeof SOURCES)[number];
  id: string;
  ciphertext: string;
}

/** Every non-empty encrypted value across the credential tables. */
async function storedCredentials(db: DatabaseAdapter): Promise<StoredCredential[]> {
  const lists = await Promise.all(
    SOURCES.map(async (source) => {
      const rows = (await db.list(db.tables[source.table])) as unknown as (Record<
        string,
        unknown
      > & {
        id: string;
      })[];
      return rows.flatMap((row) => {
        const ciphertext = row[source.column];
        return typeof ciphertext === "string" && ciphertext !== ""
          ? [{ source, id: row.id, ciphertext }]
          : [];
      });
    }),
  );
  return lists.flat();
}

function classify(keys: SecretKeys, ciphertext: string): "current" | "previous" | "unreadable" {
  try {
    return decryptWithKey(keys, ciphertext).keyUsed;
  } catch {
    return "unreadable";
  }
}

/** Count stored credentials by the key they need; read-only. */
export async function probeCredentials(
  db: DatabaseAdapter,
  keys: SecretKeys,
): Promise<CredentialProbe> {
  const stored = await storedCredentials(db);
  const probe: CredentialProbe = { total: stored.length, current: 0, previous: 0, unreadable: [] };
  for (const item of stored) {
    const state = classify(keys, item.ciphertext);
    if (state === "unreadable") {
      probe.unreadable.push({ source: item.source.name, id: item.id });
    } else {
      probe[state] += 1;
    }
  }
  return probe;
}

/**
 * Re-encrypt every credential still under `keys.previous` with `keys.current`.
 * Idempotent; unreadable rows are left untouched and reported, and one failed
 * write does not stop the rest.
 */
export async function reencryptCredentials(
  db: DatabaseAdapter,
  keys: SecretKeys,
): Promise<ReencryptResult> {
  const result: ReencryptResult = { reencrypted: 0, failed: 0, unreadable: [] };
  const outcomes = await Promise.all(
    (await storedCredentials(db)).map(async (item) => await reencryptOne(db, keys, item)),
  );
  for (const outcome of outcomes) {
    if (outcome.state === "unreadable") {
      result.unreadable.push(outcome.row);
    } else if (outcome.state !== "skipped") {
      result[outcome.state] += 1;
    }
  }
  return result;
}

type Outcome =
  | { state: "reencrypted" | "failed" | "skipped" }
  | { state: "unreadable"; row: UnreadableCredential };

async function reencryptOne(
  db: DatabaseAdapter,
  keys: SecretKeys,
  item: StoredCredential,
): Promise<Outcome> {
  let plain: { plaintext: string; keyUsed: string };
  try {
    plain = decryptWithKey(keys, item.ciphertext);
  } catch {
    return { state: "unreadable", row: { source: item.source.name, id: item.id } };
  }
  if (plain.keyUsed === "current") {
    return { state: "skipped" };
  }
  try {
    await db.update(db.tables[item.source.table], item.id, {
      [item.source.column]: encrypt(keys.current, plain.plaintext),
    });
    return { state: "reencrypted" };
  } catch {
    return { state: "failed" };
  }
}
