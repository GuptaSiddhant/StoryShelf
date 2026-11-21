import { describe, expect, it, vi } from "vitest";
import {
  authFromEnv,
  BootRefusal,
  browsersFromEnv,
  captureEnabled,
  databaseCaFromEnv,
  databaseFromEnv,
  describeBootFailure,
  isLoopback,
  poolMaxFromEnv,
  storageFromEnv,
  storybookHostingFromEnv,
  unverifiedDatabaseTls,
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
    gcs: make("gcs"),
    azure: make("azure"),
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
    expect(set.postgres).toHaveBeenCalledWith("postgresql://u:p@h/db", undefined, undefined);
    expect(set.mysql).toHaveBeenCalledWith("mysql://u:p@h/db", undefined);
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

  it("verifies the IAM database against DATABASE_CA when set, else the bundled RDS roots", () => {
    const { set, as } = factories();
    databaseFromEnv({ ...iam, DATABASE_CA: "PEM" }, "/data", as);
    expect(set.rdsIam).toHaveBeenLastCalledWith(expect.objectContaining({ ca: "PEM" }));
    databaseFromEnv(iam, "/data", as);
    expect(set.rdsIam.mock.lastCall?.[0]).not.toHaveProperty("ca");
    expect(() =>
      databaseFromEnv({ ...iam, DATABASE_CA: "a", DATABASE_CA_FILE: "/b" }, "/data", as),
    ).toThrow("Set only one of DATABASE_CA and DATABASE_CA_FILE");
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

  it("refuses to boot when only the host is missing, never reaching SQLite", () => {
    const { set, as } = factories();
    const { DATABASE_IAM_HOST: _host, ...rest } = iam;
    expect(() => databaseFromEnv(rest, "/data", as)).toThrow(/DATABASE_IAM_HOST is missing/u);
    expect(() => databaseFromEnv({ ...rest, DATABASE_IAM_HOST: "" }, "/data", as)).toThrow(
      /DATABASE_IAM_HOST is missing/u,
    );
    expect(() => databaseFromEnv({ DATABASE_IAM_USER: "shelf" }, "/data", as)).toThrow(
      /DATABASE_IAM_HOST, DATABASE_IAM_NAME/u,
    );
    expect(set.sqlite).not.toHaveBeenCalled();
  });

  it.each(["0", "70000", "5.5", "http"])("refuses DATABASE_IAM_PORT %s", (port) => {
    const { as } = factories();
    expect(() => databaseFromEnv({ ...iam, DATABASE_IAM_PORT: port }, "/data", as)).toThrow(
      /DATABASE_IAM_PORT must be a positive whole number up to 65535/u,
    );
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
    expect(set.postgres).toHaveBeenCalledWith("postgres://u:p@h/db", undefined, 7);
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

describe("storageFromEnv: GCS and Azure", () => {
  it("uses GCS from GCS_BUCKET, with the project when given", () => {
    const { set, as } = factories();
    expect(storageFromEnv({ GCS_BUCKET: "b", GOOGLE_CLOUD_PROJECT: "p" }, "/d", as).log).toEqual({
      storage: "gcs",
    });
    expect(set.gcs).toHaveBeenCalledWith({ bucket: "b", projectId: "p" });
    storageFromEnv({ GCS_BUCKET: "b" }, "/d", as);
    expect(set.gcs).toHaveBeenLastCalledWith({ bucket: "b" });
  });

  it("uses Azure Blob with the managed identity, naming the user-assigned one", () => {
    const { set, as } = factories();
    const env = {
      AZURE_STORAGE_ACCOUNT: "acct",
      AZURE_STORAGE_CONTAINER: "storybook",
      AZURE_CLIENT_ID: "cid",
    };
    expect(storageFromEnv(env, "/d", as).log).toEqual({
      storage: "azure",
      auth: "managed-identity",
    });
    expect(set.azure).toHaveBeenCalledWith({
      container: "storybook",
      accountName: "acct",
      managedIdentityClientId: "cid",
    });
    storageFromEnv({ ...env, AZURE_CLIENT_ID: "" }, "/d", as);
    expect(set.azure).toHaveBeenLastCalledWith({ container: "storybook", accountName: "acct" });
  });

  it("takes an Azure connection string for hosts without an identity, and never logs it", () => {
    const { set, as } = factories();
    const chosen = storageFromEnv(
      { AZURE_STORAGE_CONNECTION: "AccountKey=secret", AZURE_STORAGE_CONTAINER: "c" },
      "/d",
      as,
    );
    expect(set.azure).toHaveBeenCalledWith({
      container: "c",
      connectionString: "AccountKey=secret",
    });
    expect(JSON.stringify(chosen.log)).not.toContain("secret");
    expect(chosen.log).toEqual({ storage: "azure", auth: "connection-string" });
  });

  it("refuses Azure without a container", () => {
    const { as } = factories();
    expect(() => storageFromEnv({ AZURE_STORAGE_ACCOUNT: "a" }, "/d", as)).toThrow(
      "AZURE_STORAGE_CONTAINER is unset",
    );
  });

  it("refuses more than one backend", () => {
    const { as } = factories();
    expect(() => storageFromEnv({ AWS_BUCKET: "b", GCS_BUCKET: "g" }, "/d", as)).toThrow(
      "Set one storage backend",
    );
    expect(() => storageFromEnv({ GCS_BUCKET: "g", AZURE_STORAGE_ACCOUNT: "a" }, "/d", as)).toThrow(
      "Set one storage backend",
    );
  });

  it("allows both Azure variables together: they are one backend", () => {
    const { as } = factories();
    expect(
      storageFromEnv(
        { AZURE_STORAGE_ACCOUNT: "a", AZURE_STORAGE_CONNECTION: "x", AZURE_STORAGE_CONTAINER: "c" },
        "/d",
        as,
      ).log.storage,
    ).toBe("azure");
  });
});

describe("captureEnabled", () => {
  it("is on unless SHELF_CAPTURE is off", () => {
    expect(captureEnabled({})).toBe(true);
    expect(captureEnabled({ SHELF_CAPTURE: "off" })).toBe(false);
  });
});

describe("storybookHostingFromEnv", () => {
  it("is unset by default, which the app reads as trusted", () => {
    expect(storybookHostingFromEnv({})).toBeUndefined();
    expect(storybookHostingFromEnv({ SHELF_STORYBOOK_HOSTING: "" })).toBeUndefined();
  });

  it("accepts trusted and sandboxed", () => {
    expect(storybookHostingFromEnv({ SHELF_STORYBOOK_HOSTING: "trusted" })).toEqual({
      mode: "trusted",
    });
    expect(storybookHostingFromEnv({ SHELF_STORYBOOK_HOSTING: "sandboxed" })).toEqual({
      mode: "sandboxed",
    });
  });

  it("refuses anything else instead of falling back to trusted", () => {
    for (const value of ["subdomain", "Sandboxed", "off"]) {
      expect(() => storybookHostingFromEnv({ SHELF_STORYBOOK_HOSTING: value })).toThrow(
        /SHELF_STORYBOOK_HOSTING must be trusted/u,
      );
    }
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

  it("refuses a SECRET shorter than 32 characters, without echoing it", () => {
    const short = "s".repeat(31);
    expect(() => authFromEnv({ AUTH_PASSWORD: "a-long-password", SECRET: short })).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/^SECRET is shorter than 32 characters/u),
      }),
    );
    expect(() => authFromEnv({ AUTH_PASSWORD: "a-long-password", SECRET: short })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(short) }),
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

describe("describeBootFailure", () => {
  it("prints an unexpected error's reason first, then its stack frames", () => {
    const text = describeBootFailure(new Error("SECRET is unset: set it"));
    const [first, ...rest] = text.trimEnd().split("\n");
    expect(first).toBe("storyshelf: SECRET is unset: set it");
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((line) => line.trimStart().startsWith("at "))).toBe(true);
  });

  it("prints a refusal as one line with no stack frames", () => {
    expect(describeBootFailure(new BootRefusal("SECRET is unset: set it"))).toBe(
      "storyshelf: SECRET is unset: set it\n",
    );
  });

  it("refuses a missing SECRET or AUTH_PASSWORD with a BootRefusal", () => {
    for (const env of [{}, { AUTH_PASSWORD: "a-long-password" }]) {
      let caught: unknown;
      try {
        authFromEnv(env);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(BootRefusal);
    }
  });

  it("prints a non-error value on one line", () => {
    expect(describeBootFailure("boom")).toBe("storyshelf: boom\n");
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

const missing = () => {
  throw new Error("ENOENT /secret/path.pem");
};

describe("database CA", () => {
  const PEM = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n";

  it("is unset without either variable, and unchanged for the adapters", () => {
    const { set, as } = factories();
    expect(databaseCaFromEnv({})).toBeUndefined();
    databaseFromEnv({ DATABASE_URL: "postgres://u:p@h/db" }, "/data", as);
    expect(set.postgres).toHaveBeenCalledWith("postgres://u:p@h/db", undefined, undefined);
  });

  it("hands DATABASE_CA to the Postgres and MySQL adapters", () => {
    const { set, as } = factories();
    databaseFromEnv({ DATABASE_URL: "postgres://u:p@h/db", DATABASE_CA: PEM }, "/data", as);
    databaseFromEnv({ DATABASE_URL: "mysql://u:p@h/db", DATABASE_CA: PEM }, "/data", as);
    expect(set.postgres).toHaveBeenCalledWith("postgres://u:p@h/db", PEM, undefined);
    expect(set.mysql).toHaveBeenCalledWith("mysql://u:p@h/db", PEM);
  });

  it("reads DATABASE_CA_FILE", () => {
    const read = vi.fn(() => PEM);
    expect(databaseCaFromEnv({ DATABASE_CA_FILE: "/run/ca.pem" }, read)).toBe(PEM);
    expect(read).toHaveBeenCalledWith("/run/ca.pem");
  });

  it("refuses both being set, naming neither value", () => {
    const env = { DATABASE_CA: PEM, DATABASE_CA_FILE: "/secret/path.pem" };
    expect(() => databaseCaFromEnv(env)).toThrow("only one of DATABASE_CA and DATABASE_CA_FILE");
    expect(() => databaseCaFromEnv(env)).not.toThrow(/secret|BEGIN/u);
  });

  it("refuses an unreadable or empty file without echoing the path or contents", () => {
    expect(() => databaseCaFromEnv({ DATABASE_CA_FILE: "/secret/path.pem" }, missing)).toThrow(
      "could not be read",
    );
    expect(() => databaseCaFromEnv({ DATABASE_CA_FILE: "/x" }, missing)).not.toThrow(/ENOENT/u);
    expect(() => databaseCaFromEnv({ DATABASE_CA_FILE: "/x" }, () => "  \n")).toThrow("empty");
  });

  it("never puts the CA or the URL in the log object", () => {
    const { as } = factories();
    const chosen = databaseFromEnv(
      { DATABASE_URL: "postgres://u:secretpw@h/db", DATABASE_CA: PEM },
      "/data",
      as,
    );
    expect(JSON.stringify(chosen.log)).not.toMatch(/secretpw|BEGIN/u);
  });
});

const url = (query: string) => ({ DATABASE_URL: `postgres://u:p@h/db${query}` });

describe("unverifiedDatabaseTls", () => {
  it.each(["require", "prefer", "allow"])("warns for sslmode=%s without a CA", (mode) => {
    expect(unverifiedDatabaseTls(url(`?sslmode=${mode}`))).toBe(true);
    expect(unverifiedDatabaseTls(url(`?x=1&sslmode=${mode}&y=2`))).toBe(true);
  });

  it("is quiet with verify-full, no sslmode, a CA, SQLite or MySQL", () => {
    expect(unverifiedDatabaseTls(url("?sslmode=verify-full"))).toBe(false);
    expect(unverifiedDatabaseTls(url(""))).toBe(false);
    expect(unverifiedDatabaseTls({ ...url("?sslmode=require"), DATABASE_CA: "pem" })).toBe(false);
    expect(unverifiedDatabaseTls({})).toBe(false);
    expect(unverifiedDatabaseTls({ DATABASE_URL: "mysql://u:p@h/db?sslmode=require" })).toBe(false);
  });
});
