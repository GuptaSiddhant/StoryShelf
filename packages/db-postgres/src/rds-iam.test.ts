import type { Logger } from "@storyshelf/core/logger";
import { afterEach, describe, expect, it, vi } from "vitest";

const poolConfigs: Record<string, unknown>[] = [];
const queries: string[] = [];
let failQueries = false;
const pools: { end: ReturnType<typeof vi.fn> }[] = [];

/** Answer like a server unless `failQueries` is set. */
async function answer(sql: string): Promise<{ rows: unknown[] }> {
  queries.push(sql);
  if (failQueries) {
    throw new Error("connection refused");
  }
  return { rows: [] };
}
vi.mock("pg", () => ({
  Pool: vi.fn(function pool(this: Record<string, unknown>, config: Record<string, unknown>) {
    poolConfigs.push(config);
    this["query"] = vi.fn(answer);
    this["connect"] = vi.fn(async () => ({ query: answer, release: vi.fn() }));
    this["end"] = vi.fn(async () => {});
    pools.push(this as { end: ReturnType<typeof vi.fn> });
  }),
}));

const { createRdsIamDatabase } = await import("./rds-iam.ts");
const { RDS_CA_BUNDLE } = await import("./rds-ca-bundle.ts");

const base = {
  host: "db.example.rds.amazonaws.com",
  database: "storyshelf",
  user: "app",
  region: "eu-west-1",
};

/** A fake signer minting a distinct, presigned-looking token on every call. */
function fakeSigner() {
  let n = 0;
  return {
    getAuthToken: vi.fn(async () => {
      n += 1;
      return `${base.host}:5432/?Action=connect&DBUser=app&X-Amz-Signature=sig${String(n)}secret`;
    }),
  };
}

function passwordOf(index = 0): () => Promise<string> {
  return poolConfigs[index]?.["password"] as () => Promise<string>;
}

afterEach(() => {
  poolConfigs.length = 0;
  queries.length = 0;
  pools.length = 0;
  failQueries = false;
});

/** A logger that records warnings and ignores everything else. */
const quiet = (): void => {};

function recordingLogger() {
  const warnings: string[] = [];
  const logger = {
    warn: (_fields: unknown, message?: string) => {
      warnings.push(message ?? String(_fields));
    },
    info: quiet,
    debug: quiet,
    error: quiet,
    child: () => logger,
  } as unknown as Logger;
  return { logger, warnings };
}

describe("createRdsIamDatabase", () => {
  it("configures host, port, database and user with no static password", () => {
    createRdsIamDatabase({ ...base, signer: fakeSigner() });
    expect(poolConfigs[0]).toMatchObject({
      host: base.host,
      port: 5432,
      database: "storyshelf",
      user: "app",
    });
    expect(typeof poolConfigs[0]?.["password"]).toBe("function");
  });

  it("verifies the server certificate against the bundled RDS roots by default", () => {
    createRdsIamDatabase({ ...base, signer: fakeSigner() });
    expect(poolConfigs[0]?.["ssl"]).toEqual({ ca: RDS_CA_BUNDLE, rejectUnauthorized: true });
  });

  it("verifies against the `ca` given instead of the bundle", () => {
    createRdsIamDatabase({ ...base, ca: "PEM", signer: fakeSigner() });
    createRdsIamDatabase({ ...base, ca: ["A", "B"], signer: fakeSigner() });
    expect(poolConfigs[0]?.["ssl"]).toEqual({ ca: "PEM", rejectUnauthorized: true });
    expect(poolConfigs[1]?.["ssl"]).toEqual({ ca: ["A", "B"], rejectUnauthorized: true });
  });

  it("keeps verifying when verification is switched on explicitly", () => {
    createRdsIamDatabase({ ...base, verifyServerCertificate: true, signer: fakeSigner() });
    expect(poolConfigs[0]?.["ssl"]).toEqual({ ca: RDS_CA_BUNDLE, rejectUnauthorized: true });
  });

  it("never skips verification when a `ca` is given, whatever the opt-out says", () => {
    createRdsIamDatabase({
      ...base,
      ca: "PEM",
      verifyServerCertificate: false,
      signer: fakeSigner(),
    });
    expect(poolConfigs[0]?.["ssl"]).toEqual({ ca: "PEM", rejectUnauthorized: true });
  });

  describe("verifyServerCertificate: false", () => {
    it("encrypts without verifying, only on that explicit opt-out", () => {
      createRdsIamDatabase({ ...base, verifyServerCertificate: false, signer: fakeSigner() });
      expect(poolConfigs[0]?.["ssl"]).toEqual({ rejectUnauthorized: false });
    });

    it("logs one warning when the host binds a logger, without any token", async () => {
      const db = createRdsIamDatabase({
        ...base,
        verifyServerCertificate: false,
        signer: fakeSigner(),
      });
      const { logger, warnings } = recordingLogger();
      db.setLogger?.(logger);
      db.setLogger?.(logger);
      await db.lifecycle?.setup({ config: {}, logger });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("verifyServerCertificate");
      expect(warnings[0]).not.toContain("X-Amz-");
    });

    it("logs the warning from setup when no logger was bound", async () => {
      const db = createRdsIamDatabase({
        ...base,
        verifyServerCertificate: false,
        signer: fakeSigner(),
      });
      const { logger, warnings } = recordingLogger();
      await db.lifecycle?.setup({ config: {}, logger });
      expect(warnings).toHaveLength(1);
    });

    it("logs nothing when the certificate is verified", async () => {
      const db = createRdsIamDatabase({ ...base, signer: fakeSigner() });
      const { logger, warnings } = recordingLogger();
      db.setLogger?.(logger);
      await db.lifecycle?.setup({ config: {}, logger });
      expect(warnings).toEqual([]);
    });
  });

  it("asks the signer for a fresh token on every new connection", async () => {
    const signer = fakeSigner();
    createRdsIamDatabase({ ...base, signer });
    const first = await passwordOf()();
    const second = await passwordOf()();
    expect(signer.getAuthToken).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("keeps a token out of errors", async () => {
    const signer = {
      getAuthToken: vi.fn(async () => {
        throw new Error(`denied: ${base.host}:5432/?Action=connect&X-Amz-Signature=leakedsig99`);
      }),
    };
    createRdsIamDatabase({ ...base, signer });
    const error = await passwordOf()().catch((error_: unknown) => error_);
    expect((error as Error).message).toContain("rds-iam: denied");
    expect((error as Error).message).not.toContain("leakedsig99");
  });

  it("explains a missing @aws-sdk/rds-signer peer", async () => {
    vi.doMock("@aws-sdk/rds-signer", () => {
      throw new Error("Cannot find package");
    });
    createRdsIamDatabase(base);
    await expect(passwordOf()()).rejects.toThrow("@aws-sdk/rds-signer");
    vi.doUnmock("@aws-sdk/rds-signer");
  });

  it("uses the AWS signer with the configured instance, user and region", async () => {
    const ctor = vi.fn();
    vi.doMock("@aws-sdk/rds-signer", () => ({
      Signer: vi.fn(function signer(this: Record<string, unknown>, config: unknown) {
        ctor(config);
        this["getAuthToken"] = async () => "tok";
      }),
    }));
    createRdsIamDatabase({ ...base, port: 5433 });
    expect(await passwordOf()()).toBe("tok");
    expect(ctor).toHaveBeenCalledWith({
      hostname: base.host,
      port: 5433,
      username: "app",
      region: "eu-west-1",
    });
    vi.doUnmock("@aws-sdk/rds-signer");
  });

  describe("lifecycle", () => {
    const setupInput = { config: {}, logger: undefined as never };

    it("sets up twice without error", async () => {
      const db = createRdsIamDatabase({ ...base, signer: fakeSigner() });
      await db.lifecycle?.setup(setupInput);
      await db.lifecycle?.setup(setupInput);
      expect(queries.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
    });

    it("reports health ok, rejects when the database is unreachable, and not ok once closed", async () => {
      const db = createRdsIamDatabase({ ...base, signer: fakeSigner() });
      expect(await db.lifecycle?.health()).toEqual({ ok: true });
      failQueries = true;
      await expect(db.lifecycle?.health()).rejects.toThrow("connection refused");
      failQueries = false;
      await db.lifecycle?.teardown();
      expect((await db.lifecycle?.health())?.ok).toBe(false);
    });

    it("tears down twice, ending the pool it owns", async () => {
      const db = createRdsIamDatabase({ ...base, signer: fakeSigner() });
      await db.lifecycle?.teardown();
      await db.lifecycle?.teardown();
      expect(pools[0]?.end).toHaveBeenCalled();
    });
  });
});
