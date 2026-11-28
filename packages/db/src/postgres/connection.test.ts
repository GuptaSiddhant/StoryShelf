import { describe, expect, it, vi } from "vitest";
import {
  assertPostgresUrl,
  connectFailure,
  createNoticeSink,
  describeTarget,
  nameFailure,
} from "./connection.ts";

describe("assertPostgresUrl", () => {
  it("accepts both schemes", () => {
    expect(() => assertPostgresUrl("postgres://u:p@h:5432/db")).not.toThrow();
    expect(() => assertPostgresUrl("postgresql://u:p@h/db")).not.toThrow();
  });

  it("refuses a URL without a scheme, naming DATABASE_URL and never the value", () => {
    expect(() => assertPostgresUrl("localhost:5433/shelf")).toThrow(/^DATABASE_URL must start/u);
    expect(() => assertPostgresUrl("mysql://u:secret@h/db")).toThrow("postgres://");
    try {
      assertPostgresUrl("mysql://u:secret@h/db");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
    }
  });
});

describe("describeTarget", () => {
  it("names host, port and database, never the user or password", () => {
    expect(describeTarget("postgres://me:hunter2@db.example.com:5999/shelf?sslmode=require")).toBe(
      "db.example.com:5999/shelf",
    );
  });

  it("defaults the port and tolerates a missing database or a bad URL", () => {
    expect(describeTarget("postgres://h")).toBe("h:5432");
    expect(describeTarget("not a url")).toBeNull();
  });
});

describe("connectFailure", () => {
  it("names the target and the driver's reason, without the user or password", () => {
    const url = "postgres://me:hunter2@127.0.0.1:5999/shelf";
    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5999"), {
      code: "ECONNREFUSED",
    });
    const failure = connectFailure(url, error);
    expect(failure.message).toBe(
      "cannot start the database at 127.0.0.1:5999/shelf: connect ECONNREFUSED 127.0.0.1:5999",
    );
    expect(failure.message).not.toMatch(/hunter2|me:/u);
    expect(failure.cause).toBe(error);
  });

  it("cuts a connection string a driver echoed, and reads an aggregate error's first reason", () => {
    const url = "postgres://me:hunter2@h:5432/db";
    const failure = connectFailure(url, new Error(`bad ${url}`));
    expect(failure.message).not.toContain("hunter2");
    const aggregate = connectFailure(url, new AggregateError([new Error("first")]));
    expect(aggregate.message).toContain("db: first");
  });

  it("still gives the reason when there is no URL", () => {
    expect(connectFailure(undefined, "boom").message).toBe("cannot start the database: boom");
  });
});

describe("nameFailure", () => {
  it("passes a success through and rewraps a failure", async () => {
    await expect(nameFailure("postgres://h/db", async () => {})).resolves.toBeUndefined();
    await expect(
      nameFailure("postgres://h:1/db", async () => {
        throw new Error('database "db" does not exist');
      }),
    ).rejects.toThrow('cannot start the database at h:1/db: database "db" does not exist');
  });
});

describe("createNoticeSink", () => {
  it("drops a notice before a logger is attached and logs it at debug after", () => {
    const sink = createNoticeSink();
    expect(() => sink.notice({ message: "early" })).not.toThrow();
    const logger = { debug: vi.fn() };
    sink.attach(logger as never);
    sink.notice({
      severity: "NOTICE",
      code: "42P07",
      message: 'relation "x" already exists, skipping',
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { severity: "NOTICE", code: "42P07", notice: 'relation "x" already exists, skipping' },
      "postgres notice",
    );
  });
});
