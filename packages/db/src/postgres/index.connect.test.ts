import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake postgres.js: records how the adapter opens a connection from a URL, never connects.
const postgresMock = vi.hoisted(() =>
  vi.fn((_url: string, _options: Record<string, unknown>) => ({
    unsafe: vi.fn(() => Promise.resolve([])),
    end: vi.fn(() => Promise.resolve()),
  })),
);
vi.mock("postgres", () => ({ default: postgresMock }));
const drizzleMock = vi.hoisted(() => vi.fn((_client: unknown, _config: unknown) => ({})));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: drizzleMock }));

import { createPostgresDatabase } from "./index.ts";

beforeEach(() => {
  postgresMock.mockClear();
  drizzleMock.mockClear();
});

describe("createPostgresDatabase from a connection string", () => {
  it("opens one connection from `url` and maps the pool and TLS options", () => {
    createPostgresDatabase({
      url: "postgres://u:p@db.example.com:5432/shelf",
      ssl: { ca: "CA" },
      prepare: false,
      max: 7,
      idleTimeout: 20,
      connectTimeout: 9,
    });
    expect(postgresMock).toHaveBeenCalledTimes(1);
    expect(postgresMock).toHaveBeenCalledWith("postgres://u:p@db.example.com:5432/shelf", {
      ssl: { ca: "CA" },
      prepare: false,
      max: 7,
      idle_timeout: 20,
      connect_timeout: 9,
    });
  });

  it("passes no `ssl` key without the option, so the URL's sslmode applies", () => {
    createPostgresDatabase({ url: "postgres://u:p@h/db?sslmode=require" });
    expect(postgresMock.mock.calls[0]?.[1]).not.toHaveProperty("ssl");
  });

  it("prefers `connectionString` over `url`", () => {
    createPostgresDatabase({ connectionString: "postgres://a/one", url: "postgres://b/two" });
    expect(postgresMock.mock.calls[0]?.[0]).toBe("postgres://a/one");
  });

  it("refuses a URL without a scheme, naming DATABASE_URL, before opening anything", () => {
    expect(() => createPostgresDatabase({ url: "localhost:5433/shelf" })).toThrow("DATABASE_URL");
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it("routes onnotice to the adapter's logger at debug once setup hands it over", async () => {
    const db = createPostgresDatabase({ url: "postgres://u:p@h:5432/shelf" });
    const onnotice = postgresMock.mock.calls[0]?.[1]["onnotice"] as (n: unknown) => void;
    expect(() => onnotice({ message: "before setup" })).not.toThrow();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await db.lifecycle?.setup({ config: {}, logger: logger as never }).catch(() => {});
    onnotice({ severity: "NOTICE", message: "x already exists, skipping" });
    expect(logger.debug).toHaveBeenCalledWith(
      { severity: "NOTICE", code: undefined, notice: "x already exists, skipping" },
      "postgres notice",
    );
  });

  it("opens nothing when the caller supplies the client", () => {
    const client = { unsafe: vi.fn(), end: vi.fn() } as never;
    createPostgresDatabase({ client, url: "postgres://ignored/db" });
    expect(postgresMock).not.toHaveBeenCalled();
    expect(drizzleMock).toHaveBeenCalledWith({ client });
  });

  it("refuses an empty connection string without a client", () => {
    expect(() => createPostgresDatabase({ url: "" })).toThrow("provide `url`");
    expect(postgresMock).not.toHaveBeenCalled();
  });
});
