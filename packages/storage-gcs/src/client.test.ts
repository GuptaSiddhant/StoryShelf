import { describe, expect, it } from "vitest";
import { createGcsContext, resolveClientOptions } from "./client.ts";
import { createGcsStorage } from "./index.ts";

function stubClient(bucketResult: unknown = {}): unknown {
  return {
    bucket: (): unknown => bucketResult,
  };
}

describe("createGcsContext", () => {
  it("constructs a StorageAdapter without throwing", () => {
    const storage = createGcsStorage({ bucket: "test-bucket", client: stubClient() as never });

    expect(storage).toBeDefined();
    expect(typeof storage.read).toBe("function");
    expect(typeof storage.write).toBe("function");
    expect(typeof storage.delete).toBe("function");
    expect(typeof storage.exists).toBe("function");
    expect(typeof storage.list).toBe("function");
  });

  it("defaults the prefix to empty and keeps the injected bucket", () => {
    const bucket = { name: "test-bucket" };
    const ctx = createGcsContext({ bucket: "test-bucket", client: stubClient(bucket) as never });

    expect(ctx.prefix).toBe("");
    expect(ctx.bucket).toBe(bucket);
  });

  it("honors a configured prefix", () => {
    const ctx = createGcsContext({
      bucket: "test-bucket",
      prefix: "app",
      client: stubClient() as never,
    });

    expect(ctx.prefix).toBe("app");
  });
});

describe("resolveClientOptions", () => {
  it("returns an empty config when only ADC defaults apply", () => {
    expect(resolveClientOptions({ bucket: "test-bucket" })).toEqual({});
  });

  it("maps project, key file, credentials, and endpoint options", () => {
    const credentials = { client_email: "svc@example.iam.gserviceaccount.com" };

    expect(
      resolveClientOptions({
        bucket: "test-bucket",
        projectId: "my-project",
        keyFilename: "/keys/svc.json",
        credentials,
        apiEndpoint: "http://localhost:9090",
      }),
    ).toEqual({
      projectId: "my-project",
      keyFilename: "/keys/svc.json",
      credentials,
      apiEndpoint: "http://localhost:9090",
    });
  });
});
