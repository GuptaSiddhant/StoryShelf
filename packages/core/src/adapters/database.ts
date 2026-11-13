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
import type { MigrationContext } from "./skipped-index.ts";

/** A fenced reference write lost its generation race and should be retried. */
export class ReferenceGenerationConflict extends Error {}

export {
  decideMigration,
  gatedMigration,
  sqlSchemaLevelStore,
  normalizeRelease,
  SchemaTooNewError,
  type GatedMigration,
  type MigrationDecision,
  type SchemaLevelDialect,
  type SchemaLevelQuery,
  type SchemaLevelStore,
} from "./schema-level.ts";

export {
  duplicateGroupsSql,
  logSkippedIndex,
  parseUniqueIndex,
  type MigrationContext,
  type SkippedIndex,
} from "./skipped-index.ts";

export {
  BaselineSourceIntegrityError,
  type BaselineSourceProblem,
} from "./baseline-source-integrity-error.ts";

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
  schemaMeta: Table;
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
  contentUses: Table;
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
  /**
   * SQL ORDER BY condition. Every adapter appends `id` as the final tie-break,
   * and orders by `id` alone when this is omitted, so equal sort keys come back
   * in the same (creation) order on every dialect.
   */
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

/** A build tombstoned by `claimDeletion` whose cleanup has not finished, with the steps already recorded. */
export interface DeletingBuild {
  projectId: string;
  buildId: string;
  /** Its shared content was released: each hash decremented exactly once. */
  contentReleased: boolean;
  /** Its storage objects were deleted. */
  storageDeleted: boolean;
}

/**
 * How a recorded deletion step ended. `already-done` means an earlier run recorded it and nothing
 * changed; `not-deleting` means the build is gone or was never claimed; `out-of-order` means an
 * earlier step is not recorded yet.
 */
export type DeletionStepResult = "done" | "already-done" | "not-deleting" | "out-of-order";

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
   * In the same concurrency domain as admissions, irreversibly tombstone a build only if no
   * protecting reference remains. Existing tombstones are resumable and never become available.
   * Storage deletion must happen after this operation commits, outside database locks.
   */
  claimDeletion(
    projectId: string,
    buildId: string,
  ): Promise<"claimed" | "protected" | "deleting" | "missing">;
  /** Builds of the project that are `deleting`, oldest claim first: the list a cleaner resumes. */
  listDeleting(projectId: string): Promise<DeletingBuild[]>;
  /**
   * Step 1 of a claimed build's cleanup. In one transaction, record a release for each distinct
   * hash and mark the build's `content_uses` row of it released (the row stays for the grace
   * period); a hash already recorded for the build is skipped, so a retry releases nothing twice.
   * Marks the step done. Only a `deleting` build of the project qualifies.
   */
  releaseBuildContent(
    projectId: string,
    buildId: string,
    hashes: readonly string[],
  ): Promise<DeletionStepResult>;
  /** Step 2: record that the build's storage objects are deleted (needs step 1). */
  markStorageDeleted(projectId: string, buildId: string): Promise<DeletionStepResult>;
  /**
   * Step 3: in one transaction run `removeRows`, delete the build's row and its progress records
   * (needs step 2). `not-deleting` when the build is already gone, which is how a second cleaner
   * learns the work is finished.
   */
  completeDeletion<T>(
    projectId: string,
    buildId: string,
    removeRows: (tx: TxStore) => Promise<T>,
  ): Promise<{ result: T } | "not-deleting" | "out-of-order">;
  /**
   * Record that the build uses each hash of its stored content (`content_uses`): one row per
   * (build, hash), however many paths name it, so a repeat is a no-op. Returns the hashes it
   * refused because a collector has claimed them; none of the refused hashes is recorded, and the
   * caller must store the content again and retry. Same concurrency domain as {@link claimContent}.
   *
   * A claim taken before `staleBefore` (an ISO instant) belongs to a collector that stopped: the
   * record clears it in the same transaction and goes ahead, and the old collector, whose
   * {@link holdsContentClaim} check then fails, deletes nothing. Omitted, every claim refuses. A
   * build that is gone or not `available` records nothing (all its hashes are returned).
   */
  recordContentUses(
    projectId: string,
    buildId: string,
    hashes: readonly string[],
    staleBefore?: string,
  ): Promise<string[]>;
  /**
   * Claim for deletion, under the pass's `token` (a fresh id per collector pass), every hash whose
   * uses are all released, the latest release older than `idleBefore` (an ISO instant), and no
   * collector holds yet. Also takes over, to resume, the hashes whose claim is older than
   * `staleBefore` (a crashed collector's): they are re-stamped with the new token, which fences the
   * old collector out of {@link holdsContentClaim}, {@link abandonContentClaim} and
   * {@link finishContentCollection}. A fresh claim is returned to its claimer only, so two
   * collectors never delete one blob. A claimed hash admits no new use. Resolves to the claimed
   * hashes.
   */
  claimContent(token: string, idleBefore: string, staleBefore: string): Promise<string[]>;
  /**
   * Whether the hash is still claimed by this token with no unreleased use. A collector asks right
   * before it deletes the blob and skips the delete when this is false, which narrows the window a
   * taken-over collector could delete in to the time between this check and the delete itself.
   */
  holdsContentClaim(hash: string, token: string): Promise<boolean>;
  /** Give a claim back (a live build still serves the blob); only its holder can; uses stay released. */
  abandonContentClaim(hash: string, token: string): Promise<void>;
  /** The blob of a claimed hash is deleted: drop its `content_uses` rows, if the token still holds it. */
  finishContentCollection(hash: string, token: string): Promise<void>;
}

/**
 * Why an adapter that could implement {@link BuildReferenceLifecycle} withholds it: preparing the
 * baselines found a recorded source build it must not pin. Retention stays fail closed until the
 * data is fixed and the deployment restarted; the System page shows this.
 */
export interface RetentionPause {
  baselineId: string;
  buildId: string;
  /** `tombstoned`: the source build is being deleted; `other-project`: it belongs to another project. */
  problem: "tombstoned" | "other-project";
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
  /**
   * `"sequential"` when `transact` only runs its statements one after another and cannot roll back
   * (Neon over HTTP). Code that relies on one transaction for crash safety, such as the queue's
   * end-and-hand-over of a single-flight job, takes its ordered path instead. Unset means atomic,
   * as `supportsTesting` reads.
   */
  readonly transactions?: "atomic" | "sequential";
}

/** Database abstraction over Drizzle tables, agnostic of dialect and driver. */
export interface DatabaseAdapter extends Adapter<DatabaseAdapterMetadata> {
  /**
   * Present only when the adapter implements the cross-process retention safety contract.
   * `transact` by itself is not evidence of this capability.
   */
  readonly buildReferenceLifecycle?: BuildReferenceLifecycle;
  /**
   * Set when the adapter implements the capability but withheld it at boot because of a data
   * integrity problem. Absent otherwise (including adapters that never implement it).
   */
  readonly retentionPause?: RetentionPause | undefined;
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
  migrate: (context: MigrationContext) => Promise<void> | void;
  close: () => Promise<void> | void;
  /** Cheap liveness probe (e.g. `SELECT 1`); omitted when the driver has none. */
  ping?: () => Promise<void> | void;
}
