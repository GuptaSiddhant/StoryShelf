/**
 * Database adapter interface: query builders over explicitly typed tables.
 *
 * Canonical home of the database contract — {@link DatabaseAdapter},
 * {@link Tables}, {@link TxStore}, {@link ListOptions}, and
 * {@link DrizzleAdapterOptions}. Driver machinery lives in the database
 * packages (`@storyshelf/db-sqlite`, `@storyshelf/db-postgres`).
 */
import type { SQL } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { Adapter, AdapterMetadata } from "./metadata.ts";

/** Type-safe table map enforced on every DatabaseAdapter. */
export interface Tables {
  projects: Table;
  builds: Table;
  captureAttempts: Table;
  captureLogs: Table;
  captureShards: Table;
  captureJobs: Table;
  buildComponents: Table;
  buildReviews: Table;
  siteSettings: Table;
  snapshots: Table;
  baselines: Table;
  comments: Table;
  labelTypes: Table;
  buildLabels: Table;
  projectLinks: Table;
  designLinks: Table;
  designCredentials: Table;
  userConnections: Table;
  designNodes: Table;
  buildPackageUsage: Table;
  tokens: Table;
  webhooks: Table;
  insights: Table;
  aiUsage: Table;
  aiBudgetAlerts: Table;
  notificationChannels: Table;
  notificationSubscriptions: Table;
  users: Table;
  userInviteTokens: Table;
  projectMembers: Table;
  projectGroupMappings: Table;
  contentRefs: Table;
}

/** Table keys every DatabaseAdapter must expose (contract + validation share this). */
export const REQUIRED_TABLE_KEYS = [
  "projects",
  "builds",
  "snapshots",
  "baselines",
  "comments",
  "labelTypes",
  "buildLabels",
  "tokens",
  "webhooks",
  "users",
  "projectMembers",
];

/** Largest page any adapter serves in one list call. */
export const MAX_LIST_LIMIT = 1000;

/** Clamp a list limit into [1, MAX_LIST_LIMIT]; undefined stays undefined. */
export function clampListLimit(limit?: number): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  if (!Number.isFinite(limit)) {
    return MAX_LIST_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIST_LIMIT);
}

/** Options that narrow and page a list query. */
export interface ListOptions {
  /** SQL WHERE condition. */
  where?: SQL;
  /** SQL ORDER BY condition. */
  orderBy?: SQL;
  /** Maximum number of rows to return. */
  limit?: number;
  /** Number of rows to skip. */
  offset?: number;
}

/**
 * Transactional CRUD subset available inside {@link DatabaseAdapter.transact}.
 * Mirrors the adapter surface minus metadata, lifecycle, and raw `all`
 * (opaque to transactions on some drivers).
 */
export interface TxStore {
  /** Insert a row and return the inserted record. */
  insert<T extends Table>(table: T, values: T["$inferInsert"]): Promise<T["$inferSelect"]>;
  /** Update a row by id and return the updated record. */
  update<T extends Table>(
    table: T,
    id: string,
    values: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"]>;
  /** Fetch a single row by id, or null if not found. */
  get<T extends Table>(table: T, id: string): Promise<T["$inferSelect"] | null>;
  /** Delete a row by id. */
  remove(table: Table, id: string): Promise<void>;
  /** List rows matching the given options. */
  list<T extends Table>(table: T, opts?: ListOptions): Promise<T["$inferSelect"][]>;
  /** Count rows matching an optional where condition. */
  count(table: Table, where?: SQL): Promise<number>;
}

/** An owner of durable protection for a build. Historical comparisons are not build owners. */
export interface BuildReferenceOwner {
  type: "baseline" | "investigation";
  id: string;
  projectId: string;
}

/** One owner's complete new reference set for an atomic multi-owner mutation. */
export interface BuildReferenceChange {
  owner: BuildReferenceOwner;
  buildIds: readonly string[];
}

/** A complete owner reference replacement guarded by its last observed generation. */
export interface FencedBuildReferenceChange extends BuildReferenceChange {
  expectedGeneration: number;
}

/**
 * An explicit database capability; an ordinary transaction does not establish this contract.
 * Implementations serialize admissions, reference changes, and deletion claims across processes.
 * Their tests must use independent connections, including promotion/purge and pin/purge races.
 */
export interface BuildReferenceLifecycle {
  /** Return the durable generation for an owner, or zero before its first reference mutation.
   * This is a snapshot: callers must pass it to a fenced mutation, which rechecks atomically. */
  referenceGeneration(owner: BuildReferenceOwner): Promise<number>;
  /** Atomically fence and replace multiple owners, or roll back all owners and domain writes. */
  replaceManyFencedReferences<T>(
    changes: readonly FencedBuildReferenceChange[],
    writeDomain: (tx: TxStore) => Promise<T>,
  ): Promise<{ result: T; generations: number[] }>;
  /** Compare and advance an owner's durable generation with its reference and domain writes.
   * Generation zero denotes an owner with no earlier mutations. A stale generation rejects the
   * whole transaction. Generations survive release so an old worker cannot release a newer pin. */
  replaceFencedReferences<T>(
    owner: BuildReferenceOwner,
    expectedGeneration: number,
    buildIds: readonly string[],
    writeDomain: (tx: TxStore) => Promise<T>,
  ): Promise<{ result: T; generation: number }>;
  /**
   * Atomically replace one owner's complete reference set and make its domain writes. Both old and
   * new builds must be locked in stable order, checked for project ownership and availability,
   * and committed with the domain mutation. Unknown or tombstoned builds reject admission.
   */
  replaceReferences<T>(
    owner: BuildReferenceOwner,
    buildIds: readonly string[],
    writeDomain: (tx: TxStore) => Promise<T>,
  ): Promise<T>;
  /** Atomically replace several owners' reference sets and the shared domain writes. */
  replaceManyReferences<T>(
    changes: readonly BuildReferenceChange[],
    writeDomain: (tx: TxStore) => Promise<T>,
  ): Promise<T>;
  /**
   * In the same concurrency domain as admissions, irreversibly tombstone a build only if no
   * protecting reference remains. Existing tombstones are resumable and never become available.
   * Storage deletion must happen after this operation commits, outside database locks.
   */
  claimDeletion(
    projectId: string,
    buildId: string,
  ): Promise<"claimed" | "protected" | "deleting" | "missing">;
}

/** Database-specific metadata: the family plus what the backing platform can carry. */
export interface DatabaseAdapterMetadata {
  readonly category: "database";
  /**
   * `false` when the database cannot back a deployment with `testing` (ADR 0006, decision 3): it
   * is reachable only from a platform that ends the process after each request (Cloudflare D1).
   * Unset means it can.
   */
  readonly supportsTesting?: boolean;
}

/** Database abstraction over Drizzle tables, agnostic of dialect and driver. */
export interface DatabaseAdapter extends Adapter<DatabaseAdapterMetadata> {
  /**
   * Present only when the adapter implements the cross-process retention safety contract.
   * `transact` by itself is not evidence of this capability.
   */
  readonly buildReferenceLifecycle?: BuildReferenceLifecycle;
  /** Table handles for this adapter's dialect, enforced with type safety. */
  readonly tables: Tables;
  /** Insert a row and return the inserted record. */
  insert<T extends Table>(table: T, values: T["$inferInsert"]): Promise<T["$inferSelect"]>;
  /** Update a row by id and return the updated record. */
  update<T extends Table>(
    table: T,
    id: string,
    values: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"]>;
  /** Atomically update a row only while `where` matches; return the current row, or null if absent.
   * Custom adapters must implement the condition in the same database statement as the update.
   */
  updateWhere<T extends Table>(
    table: T,
    id: string,
    values: Partial<T["$inferInsert"]>,
    where: SQL,
  ): Promise<T["$inferSelect"] | null>;
  /** Fetch a single row by id, or null if not found. */
  get<T extends Table>(table: T, id: string): Promise<T["$inferSelect"] | null>;
  /** Delete a row by id. */
  remove(table: Table, id: string): Promise<void>;
  /** List rows matching the given options. */
  list<T extends Table>(table: T, opts?: ListOptions): Promise<T["$inferSelect"][]>;
  /** Count rows matching an optional where condition. */
  count(table: Table, where?: SQL): Promise<number>;
  /** Run an arbitrary SQL query and return typed rows. */
  all<T>(query: SQL): Promise<T[]>;
  /**
   * Run `fn` inside a transaction when the driver supports one.
   * Commits on resolve, rolls back on throw. Drivers without transaction
   * support omit this; callers must use `?.` and accept sequential execution.
   */
  transact?<R>(fn: (tx: TxStore) => Promise<R>): Promise<R>;
}

/** Driver-supplied identity plus lifecycle hooks. */
export interface DrizzleAdapterOptions {
  metadata: AdapterMetadata & DatabaseAdapterMetadata;
  tables: Tables;
  migrate: () => Promise<void> | void;
  close: () => Promise<void> | void;
  /** Cheap liveness probe (e.g. `SELECT 1`); omitted when the driver has none. */
  ping?: () => Promise<void> | void;
}
