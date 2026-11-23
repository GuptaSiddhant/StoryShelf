/** Setup/health/teardown lifecycle for the GCS adapter. */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { GcsContext } from "./client.ts";

/** Build the setup/health/teardown hooks probing a GCS bucket. */
export function createGcsLifecycle(ctx: GcsContext): NonNullable<StorageAdapter["lifecycle"]> {
  return {
    setup: async () => {
      await ctx.bucket.getFiles(gcsHealthQuery(ctx.prefix));
    },
    teardown: async () => {
      // GCS Storage exposes no close — connections are process-global.
      await Promise.resolve();
    },
    health: async () => {
      await ctx.bucket.getFiles(gcsHealthQuery(ctx.prefix));
      return { ok: true };
    },
  };
}

/** Single-object probe query scoped to the configured prefix. */
export function gcsHealthQuery(prefix: string): { prefix?: string; maxResults: number } {
  return prefix === "" ? { maxResults: 1 } : { prefix: `${prefix}/`, maxResults: 1 };
}
