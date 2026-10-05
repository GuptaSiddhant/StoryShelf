/** Lifecycle setup/health/teardown tests for S3 storage. */
import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import type { AdapterSetupContext } from "@storyshelf/core/adapter/metadata";
import { describe, expect, it } from "vitest";
import { createS3Storage } from "./index.ts";

const setupCtx = { config: {} } as unknown as AdapterSetupContext;

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

describe("createS3Storage - lifecycle", () => {
  it("setup probes bucket access with a single-key listing", async () => {
    const { client, sent } = makeClient();
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    await storage.lifecycle?.setup?.(setupCtx);

    expect(sent).toEqual([ListObjectsV2Command.name]);
  });

  it("health returns ok after probing bucket access", async () => {
    const { client, sent } = makeClient();
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    await expect(storage.lifecycle?.health?.()).resolves.toEqual({ ok: true });
    expect(sent).toEqual([ListObjectsV2Command.name]);
  });

  it("teardown is a no-op for injected clients", async () => {
    const { client, sent } = makeClient();
    const storage = createS3Storage({ bucket: "bkt", prefix: "app", client });

    await storage.lifecycle?.teardown?.();
    await storage.lifecycle?.teardown?.();

    expect(sent).toEqual([]);
  });

  it("teardown destroys owned clients without throwing", async () => {
    const storage = createS3Storage({ bucket: "bkt", prefix: "app" });

    await storage.lifecycle?.teardown?.();
    await expect(storage.lifecycle?.teardown?.()).resolves.toBeUndefined();
  });
});
