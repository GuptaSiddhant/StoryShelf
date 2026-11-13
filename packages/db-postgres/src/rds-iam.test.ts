import { afterEach, describe, expect, it, vi } from "vitest";

const poolConfigs: Record<string, unknown>[] = [];
vi.mock("pg", () => ({
  Pool: vi.fn(function pool(this: Record<string, unknown>, config: Record<string, unknown>) {
    poolConfigs.push(config);
    this["query"] = vi.fn(async () => ({ rows: [] }));
    this["end"] = vi.fn(async () => {});
  }),
}));

const { createRdsIamDatabase } = await import("./rds-iam.ts");

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
});

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

  it("requires TLS: encrypted without a CA, verified with one", () => {
    createRdsIamDatabase({ ...base, signer: fakeSigner() });
    createRdsIamDatabase({ ...base, ca: "PEM", signer: fakeSigner() });
    expect(poolConfigs[0]?.["ssl"]).toEqual({ rejectUnauthorized: false });
    expect(poolConfigs[1]?.["ssl"]).toEqual({ ca: "PEM" });
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
});
