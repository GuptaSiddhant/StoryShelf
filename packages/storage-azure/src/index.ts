import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  type ContainerClient,
} from "@azure/storage-blob";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { Readable } from "node:stream";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create an Azure Blob Storage-backed StorageAdapter.
 *
 * @param options - Azure configuration options.
 * @returns A StorageAdapter backed by the configured Azure container.
 */
export function createAzureStorage(options: AzureStorageOptions): StorageAdapter {
  const { container: containerName, prefix = "" } = options;
  const container = resolveContainerClient(options, containerName);
  const ctx: AzureContext = { container, prefix };

  return {
    metadata: {
      name: "Azure Blob Storage",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Azure Blob Storage adapter",
      kind: "azure",
      category: "storage",
    },
    lifecycle: {
      setup: async () => {
        await containerExists(container, containerName);
      },
      teardown: async () => {
        // ContainerClient holds no closable handle — sockets are process-global.
        await Promise.resolve();
      },
      health: async () => {
        await containerExists(container, containerName);
        return { ok: true };
      },
    },
    async read(path) {
      return await azureRead(ctx, path);
    },
    async write(path, data) {
      await azureWrite(ctx, path, data);
    },
    async delete(path) {
      await azureDelete(ctx, path);
    },
    async exists(path) {
      return await azureExists(ctx, path);
    },
    async list(listPrefix) {
      return await azureList(ctx, listPrefix);
    },
    async writeStream(path, stream) {
      await azureWriteStream(ctx, path, stream);
    },
    async readStream(path) {
      return await azureReadStream(ctx, path);
    },
  };
}

/** Options for configuring an Azure Blob Storage adapter. */
export interface AzureStorageOptions {
  /** Azure container name. */
  container: string;
  /** Optional blob prefix applied to all stored objects. */
  prefix?: string;
  /** Pre-configured container client. */
  client?: ContainerClient;
  /** Azure Storage connection string. */
  connectionString?: string;
  /** Storage account name. */
  accountName?: string;
  /** Storage account key. */
  accountKey?: string;
  /** Blob service URL (e.g. https://myaccount.blob.core.windows.net). */
  accountUrl?: string;
  /** SAS token (with or without leading `?`). */
  sasToken?: string;
}

/** Join an optional prefix with a storage path. */
export function azureKey(prefix: string, path: string): string {
  return prefix === "" ? path : `${prefix}/${path}`;
}

interface AzureContext {
  container: ContainerClient;
  prefix: string;
}

function azureRel(prefix: string, key: string): string {
  return prefix === "" ? key : key.slice(prefix.length + 1);
}

function isNotFound(error: unknown): boolean {
  const err = error as { statusCode?: number; code?: string };
  if (err.statusCode === 404) {
    return true;
  }
  return err.code === "BlobNotFound" || err.code === "ContainerNotFound" || err.code === "404";
}

function resolveContainerClient(
  options: AzureStorageOptions,
  containerName: string,
): ContainerClient {
  if (options.client) {
    return options.client;
  }
  if (options.connectionString) {
    return BlobServiceClient.fromConnectionString(options.connectionString).getContainerClient(
      containerName,
    );
  }
  return resolveFromAccount(options, containerName);
}

function resolveFromAccount(options: AzureStorageOptions, containerName: string): ContainerClient {
  const url = options.accountUrl ?? buildAccountUrl(options.accountName);
  if (!url) {
    throw new Error(
      "createAzureStorage: provide `client`, `connectionString`, or `accountName`/`accountUrl`",
    );
  }
  if (options.accountName && options.accountKey) {
    const cred = new StorageSharedKeyCredential(options.accountName, options.accountKey);
    return new BlobServiceClient(url, cred).getContainerClient(containerName);
  }
  if (options.sasToken) {
    const token = options.sasToken.replace(/^\?/u, "");
    return new BlobServiceClient(`${url}?${token}`).getContainerClient(containerName);
  }
  return new BlobServiceClient(url).getContainerClient(containerName);
}

function buildAccountUrl(accountName: string | undefined): string | undefined {
  if (!accountName) {
    return undefined;
  }
  return `https://${accountName}.blob.core.windows.net`;
}

async function containerExists(container: ContainerClient, containerName: string): Promise<void> {
  const exists = (container as unknown as { exists?: () => Promise<boolean> }).exists;
  if (typeof exists === "function") {
    const ok = await exists.call(container);
    if (!ok) {
      throw new Error(`Container not found: ${containerName}`);
    }
    return;
  }
  const iterator = container.listBlobsFlat({ prefix: "" })[Symbol.asyncIterator]();
  try {
    await iterator.next();
  } finally {
    await (iterator as { return?: () => Promise<unknown> }).return?.();
  }
}

async function azureRead(ctx: AzureContext, path: string): Promise<Buffer> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  if (
    typeof (blob as unknown as { downloadToBuffer?: () => Promise<Buffer> }).downloadToBuffer ===
    "function"
  ) {
    return await (
      blob as unknown as { downloadToBuffer: () => Promise<Buffer> }
    ).downloadToBuffer();
  }
  return await collectDownload(blob);
}

async function collectDownload(
  blob: ReturnType<ContainerClient["getBlockBlobClient"]>,
): Promise<Buffer> {
  const response = await blob.download();
  const body = response.readableStreamBody as unknown as Readable | undefined;
  if (!body) {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

async function azureWrite(ctx: AzureContext, path: string, data: Buffer): Promise<void> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  const withData = blob as unknown as {
    uploadData?: (d: Buffer) => Promise<void>;
    upload?: (d: Buffer, l: number) => Promise<void>;
  };
  if (typeof withData.uploadData === "function") {
    await withData.uploadData(data);
    return;
  }
  if (typeof withData.upload === "function") {
    await withData.upload(data, data.length);
    return;
  }
  throw new Error("Azure Blob client does not support upload");
}

async function azureDelete(ctx: AzureContext, path: string): Promise<void> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  const withDelete = blob as unknown as {
    deleteIfExists?: () => Promise<void>;
    delete?: () => Promise<void>;
  };
  if (typeof withDelete.deleteIfExists === "function") {
    await withDelete.deleteIfExists();
    return;
  }
  try {
    await withDelete.delete?.();
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

async function azureExists(ctx: AzureContext, path: string): Promise<boolean> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  return await blob.exists();
}

async function azureList(ctx: AzureContext, listPrefix: string): Promise<string[]> {
  const prefix = azureKey(ctx.prefix, listPrefix);
  const blobs: string[] = [];
  for await (const item of ctx.container.listBlobsFlat(prefix === "" ? undefined : { prefix })) {
    blobs.push(azureRel(ctx.prefix, item.name));
  }
  return blobs;
}

async function azureWriteStream(ctx: AzureContext, path: string, stream: Readable): Promise<void> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  if (await tryAzureStreamUpload(blob, stream)) {
    return;
  }
  await writeStreamBuffered(ctx, path, stream, blob);
}

async function tryAzureStreamUpload(
  blob: ReturnType<ContainerClient["getBlockBlobClient"]>,
  stream: Readable,
): Promise<boolean> {
  const withStream = blob as unknown as { uploadStream?: (s: Readable) => Promise<void> };
  if (typeof withStream.uploadStream !== "function") {
    return false;
  }
  try {
    await withStream.uploadStream(stream);
    return true;
  } catch (error) {
    await deleteBlobQuiet(blob);
    throw error;
  }
}

async function writeStreamBuffered(
  ctx: AzureContext,
  path: string,
  stream: Readable,
  blob: ReturnType<ContainerClient["getBlockBlobClient"]>,
): Promise<void> {
  try {
    const data = await collectStream(stream);
    await azureWrite(ctx, path, data);
  } catch (error) {
    await deleteBlobQuiet(blob);
    throw error;
  }
}

async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

async function deleteBlobQuiet(
  blob: ReturnType<ContainerClient["getBlockBlobClient"]>,
): Promise<void> {
  try {
    const withDelete = blob as unknown as {
      deleteIfExists?: () => Promise<void>;
      delete?: () => Promise<void>;
    };
    if (typeof withDelete.deleteIfExists === "function") {
      await withDelete.deleteIfExists();
      return;
    }
    await withDelete.delete?.();
  } catch {
    // ignore - best-effort cleanup
  }
}

async function azureReadStream(ctx: AzureContext, path: string): Promise<Readable> {
  const exists = await azureExists(ctx, path);
  if (!exists) {
    throw new Error(`No object at "${path}"`);
  }
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  const response = await blob.download();
  const body = response.readableStreamBody as unknown as Readable | undefined;
  if (!body) {
    return Readable.from([]);
  }
  return body;
}
