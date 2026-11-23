/** Client construction/injection tests for S3 storage. */
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { resolveS3Context } from "./client.ts";
import { createS3Storage } from "./index.ts";

/** A fake S3 client that records commands and returns canned responses. */
function makeClient(): { client: S3Client; sent: string[] } {
  const sent: string[] = [];
  const send = async (command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<unknown> => {
    sent.push(command.constructor.name);
    return await Promise.resolve({});
  };
  // lib-storage Upload resolves `client.config.endpoint()` before sending.
  const config = {
    endpoint: async (): Promise<unknown> =>
      await Promise.resolve({ protocol: "https:", hostname: "bkt", path: "/", query: undefined }),
  };
  return { client: { send, config } as unknown as S3Client, sent };
}

describe("createS3Storage - construct", () => {
  it("constructs a StorageAdapter without throwing", () => {
    const storage = createS3Storage({
      bucket: "test-bucket",
      prefix: "app",
      endpoint: "http://localhost:9000",
      region: "us-east-1",
    });

    expect(storage).toBeDefined();
    expect(typeof storage.read).toBe("function");
    expect(typeof storage.write).toBe("function");
    expect(typeof storage.delete).toBe("function");
    expect(typeof storage.exists).toBe("function");
    expect(typeof storage.list).toBe("function");
  });
});

describe("resolveS3Context", () => {
  it("marks injected clients as not owned", () => {
    const { client } = makeClient();

    const { ctx, ownsClient } = resolveS3Context({ bucket: "bkt", prefix: "app", client });

    expect(ctx.bucket).toBe("bkt");
    expect(ctx.prefix).toBe("app");
    expect(ctx.client).toBe(client);
    expect(ownsClient).toBe(false);
  });

  it("owns clients it constructs with region and prefix defaults", () => {
    const { ctx, ownsClient } = resolveS3Context({ bucket: "bkt" });

    expect(ctx.bucket).toBe("bkt");
    expect(ctx.prefix).toBe("");
    expect(ownsClient).toBe(true);
    ctx.client.destroy();
  });
});
