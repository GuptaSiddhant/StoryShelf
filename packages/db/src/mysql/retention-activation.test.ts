/**
 * When MySQL retention may switch on (ADR 0039). Hermetic: these cases only ever refuse. The
 * capability is never granted here; that needs the real server (`build-reference-lifecycle.live.test.ts`).
 */
import { createShelfLogger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vitest";
import { createMysqlDatabase } from "./index.ts";
import { createPlanetscaleDatabase } from "./planetscale.ts";
import {
  activateRetention,
  refusalOf,
  type RetentionActivation,
  type ServerFacts,
} from "./retention-activation.ts";
import { createTidbDatabase } from "./tidb.ts";

const innodb = Object.fromEntries(
  [
    "builds",
    "baselines",
    "build_references",
    "build_reference_generations",
    "build_deletions",
    "build_content_releases",
    "content_uses",
  ].map((table) => [table, "InnoDB"]),
);

const mysql8: ServerFacts = {
  version: "8.0.46-0ubuntu0.24.04.5",
  comment: "(Ubuntu)",
  binlog: true,
  binlogFormat: "ROW",
  engines: innodb,
};

describe("refusalOf", () => {
  it("accepts MySQL 8 with every lifecycle table on InnoDB", () => {
    expect(refusalOf(mysql8)).toBeNull();
    expect(refusalOf({ ...mysql8, version: "8.4.3", binlogFormat: "MIXED" })).toBeNull();
    expect(refusalOf({ ...mysql8, binlog: false, binlogFormat: "STATEMENT" })).toBeNull();
  });

  it.each([
    ["MariaDB", { version: "11.4.2-MariaDB", comment: "mariadb.org binary distribution" }],
    ["TiDB", { version: "8.0.11-TiDB-v7.5.1", comment: "TiDB Server" }],
    ["Vitess (PlanetScale)", { version: "8.0.34-Vitess", comment: "PlanetScale" }],
    ["MySQL 5.7", { version: "5.7.44", comment: "MySQL Community Server" }],
    ["MySQL 9", { version: "9.1.0", comment: "MySQL Community Server" }],
  ])("refuses %s", (_name, server) => {
    expect(refusalOf({ ...mysql8, ...server })).not.toBeNull();
  });

  it("refuses statement-based binary logging, which rejects READ COMMITTED writes", () => {
    expect(refusalOf({ ...mysql8, binlogFormat: "STATEMENT" })).toMatch(/binlog_format/u);
  });

  it("refuses a lifecycle table that is missing or not transactional", () => {
    const { content_uses: _dropped, ...rest } = innodb;
    expect(refusalOf({ ...mysql8, engines: rest })).toMatch(/content_uses/u);
    expect(refusalOf({ ...mysql8, engines: { ...innodb, build_references: "MyISAM" } })).toMatch(
      /build_references/u,
    );
  });
});

describe("activateRetention", () => {
  it("keeps the capability off and warns once when the source is refused", async () => {
    const warn = vi.fn();
    const state: RetentionActivation = {
      logger: { ...createShelfLogger({ level: "silent" }), warn },
    };
    await activateRetention({ refused: "the X preset is not verified" }, state);
    expect(state.lifecycle).toBeUndefined();
    expect(state.pause).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ reason: "the X preset is not verified" });
  });
});

/** A pool that answers every statement with no rows; `getConnection` must never be reached. */
function silentPool() {
  const getConnection = vi.fn(async () => {
    throw new Error("the lifecycle must not borrow a connection");
  });
  const answer = vi.fn(async () => [[], []]);
  return { query: answer, execute: answer, end: vi.fn(async () => {}), getConnection };
}

describe("fail-closed adapters", () => {
  it.each([
    ["PlanetScale", createPlanetscaleDatabase],
    ["TiDB Serverless", createTidbDatabase],
  ])("the %s preset never exposes the capability, even on a pool", async (_name, create) => {
    const pool = silentPool();
    const warn = vi.fn();
    const db = create({ client: pool as never });
    db.setLogger?.({ ...createShelfLogger({ level: "silent" }), warn });
    await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    expect(db.buildReferenceLifecycle).toBeUndefined();
    expect(pool.getConnection).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("an injected single connection never exposes the capability", async () => {
    const { getConnection: _none, ...connection } = silentPool();
    const warn = vi.fn();
    const db = createMysqlDatabase({ client: connection as never });
    db.setLogger?.({ ...createShelfLogger({ level: "silent" }), warn });
    await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    expect(db.buildReferenceLifecycle).toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toEqual({
      reason: "an injected single connection, not a pool",
    });
  });
});
