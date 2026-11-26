import { refuseRenamedSettings } from "@storyshelf/core/config";
import { isRemoteBrowser, scrubConnection, type RemoteBrowser } from "@storyshelf/runner/remote";
import { describe, expect, it, vi } from "vitest";
import {
  authFromEnv,
  BootRefusal,
  browsersFromEnv,
  captureEnabled,
  databaseCaFromEnv,
  databaseFromEnv,
  isLoopback,
  poolMaxFromEnv,
  remoteBrowserFromEnv,
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

describe("databaseFromEnv with SHELF_DATABASE_IAM_HOST", () => {
  const iam = {
    SHELF_DATABASE_IAM_HOST: "db.abc.us-east-1.rds.amazonaws.com",
    SHELF_DATABASE_IAM_USER: "shelf",
    SHELF_DATABASE_IAM_NAME: "shelf",
    SHELF_DATABASE_IAM_REGION: "us-east-1",
  };

  it("uses the rds-iam preset and never SQLite or a URL", () => {
    const { set, as } = factories();
    expect(databaseFromEnv(iam, "/data", as).log).toEqual({ database: "postgres-rds-iam" });
    expect(set.rdsIam).toHaveBeenCalledWith({
      host: iam.SHELF_DATABASE_IAM_HOST,
      user: "shelf",
      database: "shelf",
      region: "us-east-1",
    });
    expect(set.sqlite).not.toHaveBeenCalled();
    expect(set.postgres).not.toHaveBeenCalled();
  });

  it("takes the region from AWS_REGION, the port and the pool size", () => {
    const { set, as } = factories();
    const { SHELF_DATABASE_IAM_REGION: _region, ...rest } = iam;
    databaseFromEnv(
      {
        ...rest,
        AWS_REGION: "eu-west-1",
        SHELF_DATABASE_IAM_PORT: "5433",
        SHELF_DATABASE_POOL_MAX: "4",
      },
      "/data",
      as,
    );
    expect(set.rdsIam).toHaveBeenCalledWith({
      host: iam.SHELF_DATABASE_IAM_HOST,
      user: "shelf",
      database: "shelf",
      region: "eu-west-1",
      port: 5433,
      max: 4,
    });
  });

  it("verifies the IAM database against SHELF_DATABASE_CA when set, else the bundled RDS roots", () => {
    const { set, as } = factories();
    databaseFromEnv({ ...iam, SHELF_DATABASE_CA: "PEM" }, "/data", as);
    expect(set.rdsIam).toHaveBeenLastCalledWith(expect.objectContaining({ ca: "PEM" }));
    databaseFromEnv(iam, "/data", as);
    expect(set.rdsIam.mock.lastCall?.[0]).not.toHaveProperty("ca");
    expect(() =>
      databaseFromEnv(
        { ...iam, SHELF_DATABASE_CA: "a", SHELF_DATABASE_CA_FILE: "/b" },
        "/data",
        as,
      ),
    ).toThrow("Set only one of SHELF_DATABASE_CA and SHELF_DATABASE_CA_FILE");
  });

  it("refuses to boot when a variable is missing, naming it", () => {
    const { set, as } = factories();
    expect(() =>
      databaseFromEnv({ SHELF_DATABASE_IAM_HOST: iam.SHELF_DATABASE_IAM_HOST }, "/data", as),
    ).toThrow(
      /SHELF_DATABASE_IAM_USER, SHELF_DATABASE_IAM_NAME, SHELF_DATABASE_IAM_REGION \(or AWS_REGION\) is missing/u,
    );
    expect(set.sqlite).not.toHaveBeenCalled();
  });

  it("refuses to boot when only the host is missing, never reaching SQLite", () => {
    const { set, as } = factories();
    const { SHELF_DATABASE_IAM_HOST: _host, ...rest } = iam;
    expect(() => databaseFromEnv(rest, "/data", as)).toThrow(/SHELF_DATABASE_IAM_HOST is missing/u);
    expect(() => databaseFromEnv({ ...rest, SHELF_DATABASE_IAM_HOST: "" }, "/data", as)).toThrow(
      /SHELF_DATABASE_IAM_HOST is missing/u,
    );
    expect(() => databaseFromEnv({ SHELF_DATABASE_IAM_USER: "shelf" }, "/data", as)).toThrow(
      /SHELF_DATABASE_IAM_HOST, SHELF_DATABASE_IAM_NAME/u,
    );
    expect(set.sqlite).not.toHaveBeenCalled();
  });

  it.each(["0", "70000", "5.5", "http"])("refuses SHELF_DATABASE_IAM_PORT %s", (port) => {
    const { as } = factories();
    expect(() => databaseFromEnv({ ...iam, SHELF_DATABASE_IAM_PORT: port }, "/data", as)).toThrow(
      /SHELF_DATABASE_IAM_PORT must be a positive whole number up to 65535/u,
    );
  });

  it("refuses to boot with DATABASE_URL as well", () => {
    const { as } = factories();
    expect(() =>
      databaseFromEnv({ ...iam, DATABASE_URL: "postgres://u:secret-pw@h/db" }, "/data", as),
    ).toThrow(/not both/u);
  });
});

describe("SHELF_DATABASE_POOL_MAX", () => {
  it("sizes the Postgres pool", () => {
    const { set, as } = factories();
    databaseFromEnv(
      { DATABASE_URL: "postgres://u:p@h/db", SHELF_DATABASE_POOL_MAX: "7" },
      "/d",
      as,
    );
    expect(set.postgres).toHaveBeenCalledWith("postgres://u:p@h/db", undefined, 7);
  });

  it.each(["0", "-1", "2.5", "many"])("refuses %s", (value) => {
    expect(() => poolMaxFromEnv({ SHELF_DATABASE_POOL_MAX: value })).toThrow(
      /positive whole number/u,
    );
  });
});

describe("storageFromEnv", () => {
  it("uses the data volume without SHELF_S3_BUCKET", () => {
    const { set, as } = factories();
    expect(storageFromEnv({}, "/data", as).log).toEqual({ storage: "local" });
    expect(set.local).toHaveBeenCalledWith("/data");
  });

  it("uses S3 and logs only the endpoint origin", () => {
    const { set, as } = factories();
    const chosen = storageFromEnv(
      { SHELF_S3_BUCKET: "b", AWS_ENDPOINT_URL_S3: "https://s3.example.com/x?token=1" },
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
    expect(storageFromEnv({ SHELF_S3_BUCKET: "b", AWS_REGION: "eu-west-1" }, "/d", as).log).toEqual(
      {
        storage: "s3",
        endpointOrigin: null,
      },
    );
  });
});

describe("storageFromEnv: GCS and Azure", () => {
  it("uses GCS from SHELF_GCS_BUCKET, with the project when given", () => {
    const { set, as } = factories();
    expect(
      storageFromEnv({ SHELF_GCS_BUCKET: "b", GOOGLE_CLOUD_PROJECT: "p" }, "/d", as).log,
    ).toEqual({
      storage: "gcs",
    });
    expect(set.gcs).toHaveBeenCalledWith({ bucket: "b", projectId: "p" });
    storageFromEnv({ SHELF_GCS_BUCKET: "b" }, "/d", as);
    expect(set.gcs).toHaveBeenLastCalledWith({ bucket: "b" });
  });

  it("uses Azure Blob with the managed identity, naming the user-assigned one", () => {
    const { set, as } = factories();
    const env = {
      SHELF_AZURE_ACCOUNT: "acct",
      SHELF_AZURE_CONTAINER: "storybook",
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
      { SHELF_AZURE_CONNECTION_STRING: "AccountKey=secret", SHELF_AZURE_CONTAINER: "c" },
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
    expect(() => storageFromEnv({ SHELF_AZURE_ACCOUNT: "a" }, "/d", as)).toThrow(
      "SHELF_AZURE_CONTAINER is unset",
    );
  });

  it("refuses more than one backend", () => {
    const { as } = factories();
    expect(() => storageFromEnv({ SHELF_S3_BUCKET: "b", SHELF_GCS_BUCKET: "g" }, "/d", as)).toThrow(
      "Set one storage backend",
    );
    expect(() =>
      storageFromEnv({ SHELF_GCS_BUCKET: "g", SHELF_AZURE_ACCOUNT: "a" }, "/d", as),
    ).toThrow("Set one storage backend");
  });

  it("allows both Azure variables together: they are one backend", () => {
    const { as } = factories();
    expect(
      storageFromEnv(
        {
          SHELF_AZURE_ACCOUNT: "a",
          SHELF_AZURE_CONNECTION_STRING: "x",
          SHELF_AZURE_CONTAINER: "c",
        },
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

describe("remoteBrowserFromEnv (SHELF_REMOTE_BROWSER_*)", () => {
  const ENDPOINT = "wss://farm.example/ws?key=endpoint-key-9f3a";
  const TOKEN = "token-value-77c1";
  const SECRET = "s".repeat(32);
  const base = {
    SHELF_REMOTE_BROWSER_ENDPOINT: ENDPOINT,
    SHELF_REMOTE_BROWSER_TOKEN: TOKEN,
    SHELF_REMOTE_BROWSER_PROTOCOL: "playwright",
    SHELF_REMOTE_BROWSER_REACH: "loopback",
  };
  const urlReach = {
    ...base,
    SHELF_REMOTE_BROWSER_REACH: "url",
    SHELF_SECRET: SECRET,
    SHELF_PUBLIC_BASE_URL: "https://shelf.example",
  };

  /** The refusal's message, which must name `variable` and never carry a secret value. */
  function refusal(env: Record<string, string>): string {
    try {
      remoteBrowserFromEnv(env);
    } catch (error) {
      expect(error).toBeInstanceOf(BootRefusal);
      const { message } = error as Error;
      for (const secret of [ENDPOINT, "endpoint-key-9f3a", "farm.example", TOKEN, SECRET]) {
        expect(message).not.toContain(secret);
      }
      return message;
    }
    throw new Error("expected a BootRefusal");
  }

  it("is off when no SHELF_REMOTE_BROWSER_* variable is set", () => {
    expect(remoteBrowserFromEnv({})).toBeUndefined();
    expect(remoteBrowserFromEnv({ SHELF_REMOTE_BROWSER_ENDPOINT: "" })).toBeUndefined();
  });

  it("declares playwright over loopback, with chromium and one session by default", () => {
    const remote = remoteBrowserFromEnv(base) as RemoteBrowser;
    expect(isRemoteBrowser(remote)).toBe(true);
    expect(remote).toMatchObject({
      name: "remote",
      engines: ["chromium"],
      protocol: "playwright",
      reach: "loopback",
      sessions: 1,
      maxConnections: undefined,
      connect: { endpoint: ENDPOINT, headers: { authorization: `Bearer ${TOKEN}` } },
    });
  });

  it("reads every declared combination", () => {
    const pw = remoteBrowserFromEnv(urlReach) as RemoteBrowser;
    expect([pw.protocol, pw.reach]).toEqual(["playwright", "url"]);
    const cdp = remoteBrowserFromEnv({
      ...urlReach,
      SHELF_REMOTE_BROWSER_PROTOCOL: "cdp",
      SHELF_REMOTE_BROWSER_ENDPOINT: "https://farm.example/cdp",
    }) as RemoteBrowser;
    expect([cdp.protocol, cdp.reach]).toEqual(["cdp", "url"]);
  });

  it("takes a name, engines, sessions and maxConnections, and sends no header without a token", () => {
    const remote = remoteBrowserFromEnv({
      SHELF_REMOTE_BROWSER_ENDPOINT: ENDPOINT,
      SHELF_REMOTE_BROWSER_PROTOCOL: "playwright",
      SHELF_REMOTE_BROWSER_REACH: "loopback",
      SHELF_REMOTE_BROWSER_NAME: "grid",
      SHELF_REMOTE_BROWSER_ENGINES: "chromium, firefox",
      SHELF_REMOTE_BROWSER_SESSIONS: "8",
      SHELF_REMOTE_BROWSER_MAX_CONNECTIONS: "2",
    }) as RemoteBrowser;
    expect(remote).toMatchObject({
      name: "grid",
      engines: ["chromium", "firefox"],
      sessions: 8,
      maxConnections: 2,
      connect: { endpoint: ENDPOINT },
    });
    expect((remote.connect as { headers?: unknown }).headers).toBeUndefined();
  });

  it("refuses a half-set configuration, naming the variable", () => {
    const { SHELF_REMOTE_BROWSER_ENDPOINT: _endpoint, ...noEndpoint } = base;
    expect(refusal(noEndpoint)).toContain("SHELF_REMOTE_BROWSER_ENDPOINT");
    const { SHELF_REMOTE_BROWSER_PROTOCOL: _protocol, ...noProtocol } = base;
    expect(refusal(noProtocol)).toContain("SHELF_REMOTE_BROWSER_PROTOCOL");
    const { SHELF_REMOTE_BROWSER_REACH: _reach, ...noReach } = base;
    expect(refusal(noReach)).toContain("SHELF_REMOTE_BROWSER_REACH");
    expect(refusal({ SHELF_REMOTE_BROWSER_TOKEN: TOKEN })).toContain("SHELF_REMOTE_BROWSER_");
  });

  it("refuses unknown and malformed values, never echoing them", () => {
    expect(refusal({ ...base, SHELF_REMOTE_BROWSER_PROTOCOL: "bidi" })).toContain(
      "SHELF_REMOTE_BROWSER_PROTOCOL",
    );
    expect(refusal({ ...base, SHELF_REMOTE_BROWSER_REACH: "tunnel" })).toContain(
      "SHELF_REMOTE_BROWSER_REACH",
    );
    expect(
      refusal({ ...base, SHELF_REMOTE_BROWSER_ENDPOINT: "http://farm.example/k-1234" }),
    ).toContain("SHELF_REMOTE_BROWSER_ENDPOINT");
    expect(refusal({ ...base, SHELF_REMOTE_BROWSER_ENDPOINT: "not a url key-1234" })).toContain(
      "SHELF_REMOTE_BROWSER_ENDPOINT",
    );
    expect(refusal({ ...base, SHELF_REMOTE_BROWSER_NAME: "Bad Name" })).toContain(
      "SHELF_REMOTE_BROWSER_NAME",
    );
    for (const engines of ["opera", "chromium,chromium"]) {
      expect(refusal({ ...base, SHELF_REMOTE_BROWSER_ENGINES: engines })).toContain(
        "SHELF_REMOTE_BROWSER_ENGINES",
      );
    }
    for (const bad of ["0", "-1", "1.5", "many"]) {
      expect(refusal({ ...base, SHELF_REMOTE_BROWSER_SESSIONS: bad })).toContain(
        "SHELF_REMOTE_BROWSER_SESSIONS",
      );
      expect(refusal({ ...base, SHELF_REMOTE_BROWSER_MAX_CONNECTIONS: bad })).toContain(
        "SHELF_REMOTE_BROWSER_MAX_CONNECTIONS",
      );
    }
  });

  it("refuses combinations the runner cannot serve", () => {
    expect(
      refusal({
        ...base,
        SHELF_REMOTE_BROWSER_PROTOCOL: "cdp",
        SHELF_REMOTE_BROWSER_ENDPOINT: "wss://f.example/k",
      }),
    ).toContain("SHELF_REMOTE_BROWSER_REACH");
    expect(
      refusal({
        ...urlReach,
        SHELF_REMOTE_BROWSER_PROTOCOL: "cdp",
        SHELF_REMOTE_BROWSER_ENGINES: "firefox",
      }),
    ).toContain("SHELF_REMOTE_BROWSER_ENGINES");
  });

  it("needs SHELF_SECRET and a public origin for reach url", () => {
    const { SHELF_SECRET: _secret, ...noSecret } = urlReach;
    expect(refusal(noSecret)).toContain("SHELF_SECRET");
    const { SHELF_PUBLIC_BASE_URL: _origin, ...noOrigin } = urlReach;
    expect(refusal(noOrigin)).toContain("SHELF_PUBLIC_BASE_URL");
    expect(remoteBrowserFromEnv(base)).toBeDefined();
  });

  it("never lets the endpoint or token reach text the runner surfaces", () => {
    const remote = remoteBrowserFromEnv(base) as RemoteBrowser;
    const connection = remote.connect as { endpoint: string; headers: Record<string, string> };
    const text = scrubConnection(
      `connect ECONNREFUSED ${ENDPOINT} with Authorization: Bearer ${TOKEN}`,
      connection,
    );
    for (const secret of [ENDPOINT, "endpoint-key-9f3a", "farm.example", TOKEN]) {
      expect(text).not.toContain(secret);
    }
  });

  it("lists it after chromium and before chromium@azure, and refuses the azure name beside a workspace", () => {
    const azure = {
      PLAYWRIGHT_SERVICE_URL: "wss://x.example/browsers",
      PLAYWRIGHT_SERVICE_ACCESS_TOKEN: "t",
    };
    const browsers = browsersFromEnv({ ...base, ...azure });
    expect(browsers.map((entry) => (typeof entry === "string" ? entry : entry.name))).toEqual([
      "chromium",
      "remote",
      "azure",
    ]);
    expect(refusal({ ...base, ...azure, SHELF_REMOTE_BROWSER_NAME: "azure" })).toContain(
      "SHELF_REMOTE_BROWSER_NAME",
    );
    expect(remoteBrowserFromEnv({ ...base, SHELF_REMOTE_BROWSER_NAME: "azure" })).toBeDefined();
  });

  it("collapses an invalid remote() into a refusal that names only the variables", () => {
    // 10 sessions is fine; a name the runner rejects is caught by our own check first, so force remote() to throw via an unusable endpoint.
    expect(refusal({ ...base, SHELF_REMOTE_BROWSER_ENDPOINT: "ws://" })).toContain(
      "SHELF_REMOTE_BROWSER_",
    );
  });
});

describe("authFromEnv", () => {
  const secret = "s".repeat(32);

  it("signs in with SHELF_ADMIN_PASSWORD and SHELF_SECRET by default", () => {
    expect(authFromEnv({ SHELF_ADMIN_PASSWORD: "a-long-password", SHELF_SECRET: secret })).toEqual({
      mode: "password",
      password: "a-long-password",
      email: "admin@example.com",
      secret,
    });
  });

  it("refuses SHELF_ADMIN_PASSWORD without SHELF_SECRET instead of turning auth off", () => {
    expect(() => authFromEnv({ SHELF_ADMIN_PASSWORD: "a-long-password" })).toThrow(
      /^SHELF_SECRET is unset/u,
    );
    expect(() =>
      authFromEnv({ SHELF_ADMIN_PASSWORD: "a-long-password", SHELF_SECRET: "" }),
    ).toThrow(/^SHELF_SECRET is unset/u);
  });

  it("refuses a SHELF_SECRET shorter than 32 characters, without echoing it", () => {
    const short = "s".repeat(31);
    expect(() =>
      authFromEnv({ SHELF_ADMIN_PASSWORD: "a-long-password", SHELF_SECRET: short }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(/^SHELF_SECRET is shorter than 32 characters/u),
      }),
    );
    expect(() =>
      authFromEnv({ SHELF_ADMIN_PASSWORD: "a-long-password", SHELF_SECRET: short }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining(short) }));
  });

  it("refuses to start with no sign-in configured unless SHELF_AUTH=none", () => {
    expect(() => authFromEnv({})).toThrow(/^SHELF_ADMIN_PASSWORD is unset.*SHELF_AUTH=none/u);
    expect(() => authFromEnv({ SHELF_SECRET: secret })).toThrow(/^SHELF_ADMIN_PASSWORD is unset/u);
    expect(authFromEnv({ SHELF_AUTH: "none" })).toEqual({ mode: "none" });
  });

  it("refuses SHELF_AUTH=none together with SHELF_ADMIN_PASSWORD, and an unknown mode", () => {
    expect(() =>
      authFromEnv({ SHELF_AUTH: "none", SHELF_ADMIN_PASSWORD: "a-long-password" }),
    ).toThrow(/both set/u);
    expect(() => authFromEnv({ SHELF_AUTH: "off" })).toThrow(/password .* or none/u);
  });

  it("never echoes the password or the secret", () => {
    const password = "do-not-print-this-password";
    for (const env of [
      { SHELF_ADMIN_PASSWORD: password },
      { SHELF_AUTH: "none", SHELF_ADMIN_PASSWORD: password },
    ]) {
      expect(() => authFromEnv(env)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(password) }),
      );
    }
  });
});

describe("boot refusals", () => {
  it("refuses a missing SHELF_SECRET or SHELF_ADMIN_PASSWORD with a BootRefusal", () => {
    for (const env of [{}, { SHELF_ADMIN_PASSWORD: "a-long-password" }]) {
      let caught: unknown;
      try {
        authFromEnv(env);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(BootRefusal);
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

  it("hands SHELF_DATABASE_CA to the Postgres and MySQL adapters", () => {
    const { set, as } = factories();
    databaseFromEnv({ DATABASE_URL: "postgres://u:p@h/db", SHELF_DATABASE_CA: PEM }, "/data", as);
    databaseFromEnv({ DATABASE_URL: "mysql://u:p@h/db", SHELF_DATABASE_CA: PEM }, "/data", as);
    expect(set.postgres).toHaveBeenCalledWith("postgres://u:p@h/db", PEM, undefined);
    expect(set.mysql).toHaveBeenCalledWith("mysql://u:p@h/db", PEM);
  });

  it("reads SHELF_DATABASE_CA_FILE", () => {
    const read = vi.fn(() => PEM);
    expect(databaseCaFromEnv({ SHELF_DATABASE_CA_FILE: "/run/ca.pem" }, read)).toBe(PEM);
    expect(read).toHaveBeenCalledWith("/run/ca.pem");
  });

  it("refuses both being set, naming neither value", () => {
    const env = { SHELF_DATABASE_CA: PEM, SHELF_DATABASE_CA_FILE: "/secret/path.pem" };
    expect(() => databaseCaFromEnv(env)).toThrow(
      "only one of SHELF_DATABASE_CA and SHELF_DATABASE_CA_FILE",
    );
    expect(() => databaseCaFromEnv(env)).not.toThrow(/secret|BEGIN/u);
  });

  it("refuses an unreadable or empty file without echoing the path or contents", () => {
    expect(() =>
      databaseCaFromEnv({ SHELF_DATABASE_CA_FILE: "/secret/path.pem" }, missing),
    ).toThrow("could not be read");
    expect(() => databaseCaFromEnv({ SHELF_DATABASE_CA_FILE: "/x" }, missing)).not.toThrow(
      /ENOENT/u,
    );
    expect(() => databaseCaFromEnv({ SHELF_DATABASE_CA_FILE: "/x" }, () => "  \n")).toThrow(
      "empty",
    );
  });

  it("never puts the CA or the URL in the log object", () => {
    const { as } = factories();
    const chosen = databaseFromEnv(
      { DATABASE_URL: "postgres://u:secretpw@h/db", SHELF_DATABASE_CA: PEM },
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
    expect(unverifiedDatabaseTls({ ...url("?sslmode=require"), SHELF_DATABASE_CA: "pem" })).toBe(
      false,
    );
    expect(unverifiedDatabaseTls({})).toBe(false);
    expect(unverifiedDatabaseTls({ DATABASE_URL: "mysql://u:p@h/db?sslmode=require" })).toBe(false);
  });
});

describe("BUCKET_NAME, the bucket Fly's Tigris attachment injects (#1308)", () => {
  it("selects S3 only when SHELF_S3_BUCKET is unset, and counts as S3 for the one-backend rule", () => {
    const { set, as } = factories();
    expect(storageFromEnv({ BUCKET_NAME: "fly" }, "/d", as).log.storage).toBe("s3");
    expect(set.s3).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: "fly" }));
    storageFromEnv({ BUCKET_NAME: "fly", SHELF_S3_BUCKET: "own" }, "/d", as);
    expect(set.s3).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: "own" }));
    expect(() => storageFromEnv({ BUCKET_NAME: "fly", SHELF_GCS_BUCKET: "g" }, "/d", as)).toThrow(
      /Set one storage backend/u,
    );
  });

  it("is not an old name: boot does not refuse it", () => {
    expect(refuseRenamedSettings({ BUCKET_NAME: "fly" })).toEqual([]);
  });
});

describe("old variable names (#1308)", () => {
  const secret = "s".repeat(32);

  it("are never read: AUTH_PASSWORD and SECRET do not sign anyone in", () => {
    expect(() => authFromEnv({ AUTH_PASSWORD: "a-long-password", SECRET: secret })).toThrow(
      /^SHELF_ADMIN_PASSWORD is unset/u,
    );
  });

  it("are never read: an old bucket name leaves storage on the volume", () => {
    for (const name of ["AWS_BUCKET", "S3_BUCKET"]) {
      const { set, as } = factories();
      expect(storageFromEnv({ [name]: "b" }, "/d", as).log).toEqual({ storage: "local" });
      expect(set.s3).not.toHaveBeenCalled();
    }
  });

  it("stop boot: the refusal names each old name with its new one and no value", () => {
    let caught: unknown;
    try {
      refuseRenamedSettings({ SECRET: secret, AUTH_PASSWORD: "a-long-password", SHELF_AUTH: "x" });
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toBe(
      "StoryShelf's environment variables were renamed and the old names are no longer read. Rename these, then start again:\n  SECRET -> SHELF_SECRET\n  AUTH_PASSWORD -> SHELF_ADMIN_PASSWORD\nIf another service sets one of these names for itself, set SHELF_ALLOW_OLD_NAMES=1: StoryShelf then starts and still ignores them.",
    );
    expect((caught as Error).message).not.toContain(secret);
  });

  it("boot past them with SHELF_ALLOW_OLD_NAMES=1, which returns the names to warn about and reads none", () => {
    const env = { SECRET: secret, LOG_LEVEL: "debug", SHELF_ALLOW_OLD_NAMES: "1" };
    expect(refuseRenamedSettings(env)).toEqual([
      { old: "SECRET", new: "SHELF_SECRET" },
      { old: "LOG_LEVEL", new: "SHELF_LOG_LEVEL" },
    ]);
    expect(() => authFromEnv({ ...env, AUTH_PASSWORD: "a-long-password" })).toThrow(
      /^SHELF_ADMIN_PASSWORD is unset/u,
    );
  });
});
