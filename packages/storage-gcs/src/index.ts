import { Storage } from "@google-cloud/storage";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create a Google Cloud Storage (GCS) StorageAdapter.
 *
 * @param options - GCS configuration options.
 * @returns A StorageAdapter backed by the configured GCS bucket.
 */
export function createGcsStorage(options: GcsStorageOptions): StorageAdapter {
  const { bucket: bucketName, prefix = "", client: injectedClient } = options;
  const client = injectedClient ?? new Storage(resolveClientOptions(options));
  const bucket = client.bucket(bucketName);
  const ctx: GcsContext = { bucket, prefix };

  return {
    metadata: {
      name: "GCS Storage",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Google Cloud Storage adapter",
      kind: "gcs",
      category: "storage",
    },
    lifecycle: {
      setup: async () => {
        await bucket.getFiles(gcsHealthQuery(prefix));
      },
      teardown: async () => {
        // GCS Storage exposes no close — connections are process-global.
        await Promise.resolve();
      },
      health: async () => {
        const started = Date.now();
        await bucket.getFiles(gcsHealthQuery(prefix));
        return { ok: true, latencyMs: Date.now() - started };
      },
    },
    async read(path) {
      return await gcsRead(ctx, path);
    },
    async write(path, data) {
      await bucket.file(gcsKey(prefix, path)).save(data);
    },
    async delete(path) {
      await gcsDelete(ctx, path);
    },
    async exists(path) {
      return await gcsExists(ctx, path);
    },
    async list(listPrefix) {
      return await gcsList(ctx, listPrefix);
    },
    async writeStream(path, stream) {
      await gcsWriteStream(ctx, path, stream);
    },
    async readStream(path) {
      return await gcsReadStream(ctx, path);
    },
  };
}

/** Options for configuring a GCS storage adapter. */
export interface GcsStorageOptions {
  /** GCS bucket name. */
  bucket: string;
  /** Optional key prefix applied to all stored objects. */
  prefix?: string;
  /** Pre-configured GCS client. Defaults to a client built from the other options. */
  client?: Storage;
  /** GCP project ID (defaults to ADC). */
  projectId?: string;
  /** Path to service-account JSON key file. */
  keyFilename?: string;
  /** Service-account credentials object. */
  credentials?: Record<string, unknown>;
  /** Custom API endpoint (e.g. emulator: http://localhost:9090). */
  apiEndpoint?: string;
}

/** Join an optional key prefix with a storage path. */
export function gcsKey(prefix: string, path: string): string {
  return prefix === "" ? path : `${prefix}/${path}`;
}

interface GcsContext {
  bucket: ReturnType<Storage["bucket"]>;
  prefix: string;
}

function gcsRel(prefix: string, key: string): string {
  return prefix === "" ? key : key.slice(prefix.length + 1);
}

function isNotFound(error: unknown): boolean {
  const err = error as {
    code?: number | string;
    statusCode?: number;
    errors?: { reason?: string }[];
  };
  if (err.code === 404 || err.code === "404" || err.code === "notFound") {
    return true;
  }
  if (err.statusCode === 404) {
    return true;
  }
  return err.errors?.[0]?.reason === "notFound";
}

function resolveClientOptions(
  options: GcsStorageOptions,
): ConstructorParameters<typeof Storage>[0] {
  const config: ConstructorParameters<typeof Storage>[0] = {};
  if (options.projectId !== undefined) {
    config.projectId = options.projectId;
  }
  if (options.keyFilename !== undefined) {
    config.keyFilename = options.keyFilename;
  }
  if (options.credentials !== undefined) {
    config.credentials = options.credentials;
  }
  if (options.apiEndpoint !== undefined) {
    config.apiEndpoint = options.apiEndpoint;
  }
  return config;
}

function gcsHealthQuery(prefix: string): { prefix?: string; maxResults: number } {
  return prefix === "" ? { maxResults: 1 } : { prefix: `${prefix}/`, maxResults: 1 };
}

async function gcsRead(ctx: GcsContext, path: string): Promise<Buffer> {
  const file = ctx.bucket.file(gcsKey(ctx.prefix, path));
  const [data] = await file.download();
  return data;
}

async function gcsDelete(ctx: GcsContext, path: string): Promise<void> {
  try {
    await ctx.bucket.file(gcsKey(ctx.prefix, path)).delete();
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

async function gcsExists(ctx: GcsContext, path: string): Promise<boolean> {
  const [exists] = await ctx.bucket.file(gcsKey(ctx.prefix, path)).exists();
  return exists;
}

async function gcsList(ctx: GcsContext, listPrefix: string): Promise<string[]> {
  const prefix = gcsKey(ctx.prefix, listPrefix);
  const results: string[] = [];
  let query: Record<string, unknown> | undefined =
    prefix === "" ? { autoPaginate: false } : { prefix, autoPaginate: false };
  while (query !== undefined) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pagination requires sequential awaits
    const [files, nextQuery] = (await ctx.bucket.getFiles(query as never)) as unknown as [
      { name: string }[],
      Record<string, unknown> | null,
    ];
    for (const file of files) {
      results.push(gcsRel(ctx.prefix, file.name));
    }
    query = nextQueryQuery(nextQuery);
  }
  return results;
}

function nextQueryQuery(
  nextQuery: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!nextQuery || typeof nextQuery !== "object") {
    return undefined;
  }
  const token = (nextQuery as { pageToken?: string }).pageToken;
  return token ? nextQuery : undefined;
}

async function gcsWriteStream(ctx: GcsContext, path: string, stream: Readable): Promise<void> {
  const file = ctx.bucket.file(gcsKey(ctx.prefix, path));
  const dest = file.createWriteStream({ resumable: false });
  try {
    await pipeline(stream, dest);
  } catch (error) {
    try {
      await file.delete({ ignoreNotFound: true });
    } catch {
      // ignore cleanup failure, rethrow original error
    }
    throw error;
  }
}

async function gcsReadStream(ctx: GcsContext, path: string): Promise<Readable> {
  const file = ctx.bucket.file(gcsKey(ctx.prefix, path));
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`No object at "${path}"`);
  }
  return file.createReadStream();
}
