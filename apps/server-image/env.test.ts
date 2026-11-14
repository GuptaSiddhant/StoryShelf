import { describe, expect, it, vi } from "vitest";
import {
  browsersFromEnv,
  captureEnabled,
  databaseFromEnv,
  poolMaxFromEnv,
  storageFromEnv,
  type Factories,
} from "./env.ts";

const make = (name: string) => vi.fn((_arg: unknown) => ({ name }) as never);

function factories() {
  const set = {
    sqlite: make("sqlite"),
    postgres: make("postgres"),
    rdsIam: make("rds-iam"),
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
    expect(set.postgres).toHaveBeenCalledWith("postgresql://u:p@h/db", undefined);
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

describe("databaseFromEnv with DATABASE_IAM_HOST", () => {
  const iam = {
    DATABASE_IAM_HOST: "db.abc.us-east-1.rds.amazonaws.com",
    DATABASE_IAM_USER: "shelf",
    DATABASE_IAM_NAME: "shelf",
    DATABASE_IAM_REGION: "us-east-1",
  };

  it("uses the rds-iam preset and never SQLite or a URL", () => {
    const { set, as } = factories();
    expect(databaseFromEnv(iam, "/data", as).log).toEqual({ database: "postgres-rds-iam" });
    expect(set.rdsIam).toHaveBeenCalledWith({
      host: iam.DATABASE_IAM_HOST,
      user: "shelf",
      database: "shelf",
      region: "us-east-1",
    });
    expect(set.sqlite).not.toHaveBeenCalled();
    expect(set.postgres).not.toHaveBeenCalled();
  });

  it("takes the region from AWS_REGION, the port and the pool size", () => {
    const { set, as } = factories();
    const { DATABASE_IAM_REGION: _region, ...rest } = iam;
    databaseFromEnv(
      { ...rest, AWS_REGION: "eu-west-1", DATABASE_IAM_PORT: "5433", DATABASE_POOL_MAX: "4" },
      "/data",
      as,
    );
    expect(set.rdsIam).toHaveBeenCalledWith({
      host: iam.DATABASE_IAM_HOST,
      user: "shelf",
      database: "shelf",
      region: "eu-west-1",
      port: 5433,
      max: 4,
    });
  });

  it("refuses to boot when a variable is missing, naming it", () => {
    const { set, as } = factories();
    expect(() =>
      databaseFromEnv({ DATABASE_IAM_HOST: iam.DATABASE_IAM_HOST }, "/data", as),
    ).toThrow(
      /DATABASE_IAM_USER, DATABASE_IAM_NAME, DATABASE_IAM_REGION \(or AWS_REGION\) is missing/u,
    );
    expect(set.sqlite).not.toHaveBeenCalled();
  });

  it("refuses to boot with DATABASE_URL as well", () => {
    const { as } = factories();
    expect(() =>
      databaseFromEnv({ ...iam, DATABASE_URL: "postgres://u:secret-pw@h/db" }, "/data", as),
    ).toThrow(/not both/u);
  });
});

describe("DATABASE_POOL_MAX", () => {
  it("sizes the Postgres pool", () => {
    const { set, as } = factories();
    databaseFromEnv({ DATABASE_URL: "postgres://u:p@h/db", DATABASE_POOL_MAX: "7" }, "/d", as);
    expect(set.postgres).toHaveBeenCalledWith("postgres://u:p@h/db", 7);
  });

  it.each(["0", "-1", "2.5", "many"])("refuses %s", (value) => {
    expect(() => poolMaxFromEnv({ DATABASE_POOL_MAX: value })).toThrow(/positive whole number/u);
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
