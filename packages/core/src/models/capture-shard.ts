/** Shard rows of a sharded capture: the plan, the render slices, and the finalize claim. */
import { asc, eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { CaptureShard, CaptureShardKind } from "../schema/capture-shard.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** Tables required by {@link CaptureShardModel}. */
export interface CaptureShardTables {
  captureShards: Table;
}

/** A render shard to create: its JSON payload (the slice of stories and engines). */
export interface NewRenderShard {
  payload: string;
}

/** Data operations for the stages of a sharded capture. */
export class CaptureShardModel {
  readonly #db: DatabaseAdapter;
  readonly #table: Table;

  constructor(db: DatabaseAdapter, tables?: CaptureShardTables) {
    this.#db = db;
    this.#table = (tables ?? { captureShards: db.tables.captureShards }).captureShards;
  }

  async get(id: string): Promise<CaptureShard | null> {
    return (await this.#db.get(this.#table, id)) as unknown as CaptureShard | null;
  }

  /** Every row of a build, in plan, render, finalize and ordinal order. */
  async listForBuild(buildId: string): Promise<CaptureShard[]> {
    const rows = (await this.#db.list(this.#table, {
      where: eq(col(this.#table, "buildId"), buildId),
      orderBy: asc(col(this.#table, "ordinal")),
    })) as unknown as CaptureShard[];
    return rows.toSorted((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.ordinal - b.ordinal);
  }

  async renderShards(buildId: string): Promise<CaptureShard[]> {
    return (await this.listForBuild(buildId)).filter((row) => row.kind === "render");
  }

  async plan(buildId: string): Promise<CaptureShard | null> {
    return (await this.listForBuild(buildId)).find((row) => row.kind === "plan") ?? null;
  }

  /** Forget every stage of a build: a new plan (retry, recovery) starts clean. */
  async clearBuild(buildId: string): Promise<void> {
    const rows = await this.listForBuild(buildId);
    await Promise.all(
      rows.map(async (row) => {
        await this.#db.remove(this.#table, row.id);
      }),
    );
  }

  /**
   * Record a plan: the plan row (already `done`, it ran) and one `pending` render shard per slice.
   * Returns the render shards in ordinal order.
   */
  async createPlan(
    projectId: string,
    buildId: string,
    plan: { attemptId: string | null; payload: string; result: string },
    shards: NewRenderShard[],
  ): Promise<CaptureShard[]> {
    const now = new Date().toISOString();
    await this.#db.insert(this.#table, {
      ...base(projectId, buildId, "plan", 0, now),
      id: `${buildId}:plan`,
      status: "done",
      attemptId: plan.attemptId,
      payload: plan.payload,
      result: plan.result,
      startedAt: now,
      finishedAt: now,
    });
    return await Promise.all(
      shards.map(
        async (shard, index) =>
          (await this.#db.insert(this.#table, {
            ...base(projectId, buildId, "render", index + 1, now),
            id: ulid(),
            payload: shard.payload,
          })) as unknown as CaptureShard,
      ),
    );
  }

  /** Mark a shard running. A shard already done stays done: this run is a redelivered duplicate. */
  async markRunning(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.#unlessDone(id, { status: "running", startedAt: now, updatedAt: now });
  }

  /** Finish a shard with its outcome (JSON). Idempotent: a redelivered shard overwrites its own result. */
  async complete(id: string, result: string): Promise<void> {
    const now = new Date().toISOString();
    await this.#db.update(this.#table, id, {
      status: "done",
      result,
      error: null,
      finishedAt: now,
      updatedAt: now,
    });
  }

  /**
   * A failed run that will be retried: back to `pending`, remembering why. Ignored for a shard
   * already done, whose result a failing duplicate must not undo.
   */
  async retry(id: string, error: string): Promise<void> {
    await this.#unlessDone(id, {
      status: "pending",
      error,
      updatedAt: new Date().toISOString(),
    });
  }

  /** The shard's last try failed. Ignored for a shard already done, like {@link retry}. */
  async fail(id: string, error: string): Promise<void> {
    const now = new Date().toISOString();
    await this.#unlessDone(id, { status: "failed", error, finishedAt: now, updatedAt: now });
  }

  /**
   * A queue that redelivers (at-least-once) can run one shard twice. Whichever finishes first wins;
   * the other must not move the row out of `done`. Read-then-write, not atomic, but the window is
   * the time between two statements, and the outcome of losing it is one extra identical write.
   */
  async #unlessDone(id: string, patch: Record<string, unknown>): Promise<void> {
    if ((await this.get(id))?.status === "done") {
      return;
    }
    await this.#db.update(this.#table, id, patch);
  }

  /**
   * Try to become the one worker that finalizes the build. The claim row's primary key is
   * `<buildId>:finalize`, so inserting it succeeds for exactly one caller on every database;
   * everyone else gets a key conflict, which this reports as `false`.
   *
   * A claim still `running` after {@link FINALIZE_STALE_MS} belonged to a worker that died
   * mid-finalize, and is taken over. Two late takers can both win; finalizing is idempotent.
   */
  async claimFinalize(projectId: string, buildId: string, now = new Date()): Promise<boolean> {
    const id = finalizeId(buildId);
    try {
      await this.#db.insert(this.#table, {
        ...base(projectId, buildId, "finalize", 0, now.toISOString()),
        id,
        status: "running",
        startedAt: now.toISOString(),
      });
      return true;
    } catch (error) {
      // A conflict means someone else holds the claim; anything else is a real failure.
      const held = await this.get(id);
      if (held === null) {
        throw error;
      }
      return await this.#takeOverStale(held, now);
    }
  }

  /** The finalize ran to the end: its claim is closed for good. */
  async finishFinalize(buildId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.#db.update(this.#table, finalizeId(buildId), {
      status: "done",
      finishedAt: now,
      updatedAt: now,
    });
  }

  /** The finalize failed: drop its claim, so the next run to reduce the build can finalize it. */
  async releaseFinalize(buildId: string): Promise<void> {
    await this.#db.remove(this.#table, finalizeId(buildId));
  }

  async #takeOverStale(held: CaptureShard, now: Date): Promise<boolean> {
    const since = Date.parse(held.startedAt ?? held.createdAt);
    if (held.status !== "running" || now.getTime() - since < FINALIZE_STALE_MS) {
      return false;
    }
    await this.#db.update(this.#table, held.id, {
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    return true;
  }
}

/**
 * How long a finalize claim may stay `running` before it counts as abandoned. Finalizing is a
 * handful of queries over the build's snapshots, so minutes is long past any healthy run.
 */
export const FINALIZE_STALE_MS = 5 * 60_000;

function finalizeId(buildId: string): string {
  return `${buildId}:finalize`;
}

type NewShardRow = Omit<CaptureShard, "id">;

function base(
  projectId: string,
  buildId: string,
  kind: CaptureShardKind,
  ordinal: number,
  now: string,
): NewShardRow {
  return {
    projectId,
    buildId,
    kind,
    ordinal,
    status: "pending",
    attemptId: null,
    payload: null,
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function kindRank(kind: CaptureShardKind): number {
  return kind === "plan" ? 0 : kind === "render" ? 1 : 2;
}
