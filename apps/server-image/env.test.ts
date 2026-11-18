import { describe, expect, it, vi } from "vitest";
import {
  authFromEnv,
  browsersFromEnv,
  captureEnabled,
  databaseFromEnv,
  isLoopback,
  storageFromEnv,
  type Factories,
} from "./env.ts";

const make = (name: string) => vi.fn((_arg: unknown) => ({ name }) as never);

function factories() {
  const set = {
    sqlite: make("sqlite"),
    postgres: make("postgres"),
    mysql: make("mysql"),
    s3: make("s3"),
    local: make("local"),
  };
  return { set, as: set as unknown as Factories };
}

describe("databaseFromEnv", () => {
  it("uses SQLite on the data volume without DATABASE_URL", () => {
    const { set, as } = factories();
    expect(databaseFromEnv({}, "/data", as).log).toEqual({ database: "sqlite" });
    expect(set.sqlite).toHaveBeenCalledWith("/data/shelf.db");
  });

  it("picks Postgres and MySQL by scheme", () => {
    const { set, as } = factories();
    databaseFromEnv({ DATABASE_URL: "postgresql://u:p@h/db" }, "/data", as);
    databaseFromEnv({ DATABASE_URL: "mysql://u:p@h/db" }, "/data", as);
    expect(set.postgres).toHaveBeenCalledWith("postgresql://u:p@h/db");
    expect(set.mysql).toHaveBeenCalledWith("mysql://u:p@h/db");
  });

  it("refuses another scheme without echoing the URL", () => {
    const { as } = factories();
    expect(() => databaseFromEnv({ DATABASE_URL: "sqlite://secret-pw" }, "/data", as)).toThrow(
      /must start with/u,
    );
    expect(() => databaseFromEnv({ DATABASE_URL: "sqlite://secret-pw" }, "/data", as)).not.toThrow(
      /secret-pw/u,
    );
  });
});

describe("storageFromEnv", () => {
  it("uses the data volume without AWS_BUCKET", () => {
    const { set, as } = factories();
    expect(storageFromEnv({}, "/data", as).log).toEqual({ storage: "local" });
    expect(set.local).toHaveBeenCalledWith("/data");
  });

  it("uses S3 and logs only the endpoint origin", () => {
    const { set, as } = factories();
    const chosen = storageFromEnv(
      { AWS_BUCKET: "b", AWS_ENDPOINT_URL_S3: "https://s3.example.com/x?token=1" },
      "/data",
      as,
    );
    expect(set.s3).toHaveBeenCalledWith({
      bucket: "b",
      endpoint: "https://s3.example.com/x?token=1",
      region: "auto",
    });
    expect(chosen.log).toEqual({ storage: "s3", endpointOrigin: "https://s3.example.com" });
  });

  it("logs a null origin when the endpoint is the SDK default", () => {
    const { as } = factories();
    expect(storageFromEnv({ AWS_BUCKET: "b", AWS_REGION: "eu-west-1" }, "/d", as).log).toEqual({
      storage: "s3",
      endpointOrigin: null,
    });
  });
});

describe("captureEnabled", () => {
  it("is on unless SHELF_CAPTURE is off", () => {
    expect(captureEnabled({})).toBe(true);
    expect(captureEnabled({ SHELF_CAPTURE: "off" })).toBe(false);
  });
});

describe("browsersFromEnv", () => {
  it("is the bundled Chromium only by default", () => {
    expect(browsersFromEnv({})).toEqual(["chromium"]);
    expect(browsersFromEnv({ PLAYWRIGHT_SERVICE_URL: "wss://x.example/browsers" })).toEqual([
      "chromium",
    ]);
  });

  it("adds chromium@azure when the endpoint and token are set", () => {
    const browsers = browsersFromEnv({
      PLAYWRIGHT_SERVICE_URL: "wss://x.example/browsers",
      PLAYWRIGHT_SERVICE_ACCESS_TOKEN: "t",
    });
    expect(browsers).toHaveLength(2);
    expect(browsers[0]).toBe("chromium");
    expect(typeof browsers[1]).toBe("object");
  });
});

describe("authFromEnv", () => {
  const secret = "s".repeat(32);

  it("signs in with AUTH_PASSWORD and SECRET by default", () => {
    expect(authFromEnv({ AUTH_PASSWORD: "a-long-password", SECRET: secret })).toEqual({
      mode: "password",
      password: "a-long-password",
      email: "admin@example.com",
      secret,
    });
  });

  it("refuses AUTH_PASSWORD without SECRET instead of turning auth off", () => {
    expect(() => authFromEnv({ AUTH_PASSWORD: "a-long-password" })).toThrow(/^SECRET is unset/u);
    expect(() => authFromEnv({ AUTH_PASSWORD: "a-long-password", SECRET: "" })).toThrow(
      /^SECRET is unset/u,
    );
  });

  it("refuses to start with no sign-in configured unless SHELF_AUTH=none", () => {
    expect(() => authFromEnv({})).toThrow(/^AUTH_PASSWORD is unset.*SHELF_AUTH=none/u);
    expect(() => authFromEnv({ SECRET: secret })).toThrow(/^AUTH_PASSWORD is unset/u);
    expect(authFromEnv({ SHELF_AUTH: "none" })).toEqual({ mode: "none" });
  });

  it("refuses SHELF_AUTH=none together with AUTH_PASSWORD, and an unknown mode", () => {
    expect(() => authFromEnv({ SHELF_AUTH: "none", AUTH_PASSWORD: "a-long-password" })).toThrow(
      /both set/u,
    );
    expect(() => authFromEnv({ SHELF_AUTH: "off" })).toThrow(/password .* or none/u);
  });

  it("never echoes the password or the secret", () => {
    const password = "do-not-print-this-password";
    for (const env of [
      { AUTH_PASSWORD: password },
      { SHELF_AUTH: "none", AUTH_PASSWORD: password },
    ]) {
      expect(() => authFromEnv(env)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(password) }),
      );
    }
  });
});

describe("isLoopback", () => {
  it("tells loopback addresses from the wildcard and public ones", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("0.0.0.0")).toBe(false);
    expect(isLoopback("10.0.0.5")).toBe(false);
  });
});
