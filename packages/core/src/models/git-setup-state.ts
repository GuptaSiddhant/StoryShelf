/**
 * The `state` of a git setup flow that leaves the app (ADR 0054, decision 5): GitHub's App manifest
 * flow returns to StoryShelf by a cross-site `GET` carrying it. A state is random, bound to the
 * session that started the flow, lives ten minutes and is used once.
 *
 * It is kept in `site_settings` (no new table, ADR 0053) under the SHA-256 of the state, so the
 * database never holds a value that would finish someone's flow; the session is kept hashed too.
 * {@link GitSetupStateModel.consume} spends it with a compare-and-set, so two posts racing with one
 * state cannot both win. Never log a state.
 */
import { and, eq, like, lt } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { SiteSetting } from "../schema/site-setting.ts";
import { randomToken, sha256 } from "../utils/hash.ts";
import { col } from "./columns.ts";

/** How long a setup flow may take, from the start post to the confirming post. */
export const GIT_SETUP_STATE_TTL_MS = 10 * 60_000;

/** Key prefix of setup states in `site_settings`. */
const KEY_PREFIX = "git_setup:";

/** Prefix of the value a spent state is swapped to (with a marker of its spender) before removal. */
const SPENT = "spent:";

/** Most expired states removed when a new one is issued. */
const PRUNE_LIMIT = 50;

/** Tables required by {@link GitSetupStateModel}. */
export interface GitSetupStateTables {
  siteSettings: Table;
}

/** What a flow remembers between its start and its return; never a secret. */
export type GitSetupPayload = Readonly<Record<string, string | boolean>>;

interface StoredState {
  session: string;
  expiresAt: number;
  payload: GitSetupPayload;
}

/** Single-use, session-bound setup states. */
export class GitSetupStateModel {
  readonly #db: DatabaseAdapter;
  readonly #table: Table;

  constructor(db: DatabaseAdapter, tables?: GitSetupStateTables) {
    this.#db = db;
    this.#table = (tables ?? { siteSettings: db.tables.siteSettings }).siteSettings;
  }

  /** Issue a state for `session` remembering `payload`; expired states are pruned first. */
  async issue(session: string, payload: GitSetupPayload, now = Date.now()): Promise<string> {
    await this.#prune(now);
    const { value, hash } = randomToken("gss_");
    const stored: StoredState = {
      session: sha256(session),
      expiresAt: now + GIT_SETUP_STATE_TTL_MS,
      payload,
    };
    const at = new Date(now).toISOString();
    await this.#db.insert(this.#table, {
      id: `${KEY_PREFIX}${hash}`,
      value: JSON.stringify(stored),
      updatedBy: null,
      createdAt: at,
      updatedAt: at,
    });
    return value;
  }

  /** The payload of a live state of `session`, without spending it (the confirm page); else null. */
  async peek(state: string, session: string, now = Date.now()): Promise<GitSetupPayload | null> {
    const row = await this.#row(state);
    return row === null ? null : (liveFor(row.value, session, now)?.payload ?? null);
  }

  /**
   * Spend a live state of `session` and return its payload; null when it is unknown, expired,
   * another session's or already spent. Only one caller ever gets the payload.
   */
  async consume(state: string, session: string, now = Date.now()): Promise<GitSetupPayload | null> {
    const row = await this.#row(state);
    const live = row === null ? null : liveFor(row.value, session, now);
    if (row === null || live === null) {
      return null;
    }
    // A refused compare-and-set answers the current row, so each spender writes its own marker.
    const marker = `${SPENT}${randomToken("").value}`;
    const spent = (await this.#db.updateWhere(
      this.#table,
      row.id,
      { value: marker, updatedAt: new Date(now).toISOString() },
      eq(col(this.#table, "value"), row.value),
    )) as SiteSetting | null;
    if (spent?.value !== marker) {
      return null;
    }
    await this.#db.remove(this.#table, row.id);
    return live.payload;
  }

  async #row(state: string): Promise<SiteSetting | null> {
    if (!/^gss_[\w-]{16,64}$/u.test(state)) {
      return null;
    }
    return (await this.#db.get(this.#table, `${KEY_PREFIX}${sha256(state)}`)) as SiteSetting | null;
  }

  /** Remove states older than their life (abandoned flows); each lives at most ten minutes. */
  async #prune(now: number): Promise<void> {
    const cutoff = new Date(now - GIT_SETUP_STATE_TTL_MS).toISOString();
    const stale = (await this.#db.list(this.#table, {
      where: and(
        like(col(this.#table, "id"), `${KEY_PREFIX}%`),
        lt(col(this.#table, "createdAt"), cutoff),
      ),
      limit: PRUNE_LIMIT,
    })) as SiteSetting[];
    await Promise.all(
      stale.map(async (row) => {
        await this.#db.remove(this.#table, row.id);
      }),
    );
  }
}

/** The stored state when it is live and `session`'s; else null. */
function liveFor(value: string, session: string, now: number): StoredState | null {
  let stored: StoredState;
  try {
    stored = JSON.parse(value) as StoredState;
  } catch {
    return null;
  }
  if (typeof stored !== "object" || stored === null || typeof stored.expiresAt !== "number") {
    return null;
  }
  return stored.expiresAt > now && stored.session === sha256(session) ? stored : null;
}
