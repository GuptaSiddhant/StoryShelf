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

  it("prefers `connectionString` over `url`", () => {
    createPostgresDatabase({ connectionString: "postgres://a/one", url: "postgres://b/two" });
    expect(postgresMock.mock.calls[0]?.[0]).toBe("postgres://a/one");
  });

  it("opens nothing when the caller supplies the client", () => {
    const client = { unsafe: vi.fn(), end: vi.fn() } as never;
    createPostgresDatabase({ client, url: "postgres://ignored/db" });
    expect(postgresMock).not.toHaveBeenCalled();
    expect(drizzleMock).toHaveBeenCalledWith(client, expect.any(Object));
  });

  it("refuses an empty connection string without a client", () => {
    expect(() => createPostgresDatabase({ url: "" })).toThrow("provide `url`");
    expect(postgresMock).not.toHaveBeenCalled();
  });
});
