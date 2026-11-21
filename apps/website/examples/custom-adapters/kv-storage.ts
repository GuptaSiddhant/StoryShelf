import type { AdapterHealth, AdapterLifecycle } from "@storyshelf/core/adapter/metadata";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Logger } from "@storyshelf/core/logger";
import { HttpError, httpJson, httpStatus, httpText } from "@storyshelf/core/utils";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

/** Where the key-value service lives and how to authenticate to it. */
export interface KvStorageOptions {
  baseUrl: string;
  /** The service token: sent as a header, never logged or put in an error. */
  token: string;
  /** An explicit logger wins over the one the host binds with `setLogger`. */
  logger?: Logger;
}

/** Storage on a small HTTP key-value service (`/v1/objects/<key>`), values sent as base64 JSON. */
export function createKvStorage(options: KvStorageOptions): StorageAdapter {
  const api = createKvApi(options);
  return {
    metadata: { name: "Key-value storage", version: "0.0.0", kind: "kv-http", category: "storage" },
    setLogger: api.bindLogger,
    lifecycle: kvLifecycle(api),
    ...kvObjects(api),
  };
}

/** What every request needs: URLs, the auth header and the current logger. */
interface KvApi {
  base: string;
  objectUrl(path: string): string;
  request(): { headers: Record<string, string>; logger: Logger | undefined };
  bindLogger(bound: Logger): void;
}

function createKvApi(options: KvStorageOptions): KvApi {
  const base = options.baseUrl.replace(/\/+$/u, "");
  const headers = { authorization: `Bearer ${options.token}` };
  let logger = options.logger?.child({ component: "storage-kv" });
  return {
    base,
    objectUrl: (path) => `${base}/v1/objects/${encodeURIComponent(safe(path))}`,
    request: () => ({ headers, logger }),
    bindLogger(bound): void {
      logger = (options.logger ?? bound).child({ component: "storage-kv" });
    },
  };
}

/** All three hooks or none; each is safe to call twice. */
function kvLifecycle(api: KvApi): AdapterLifecycle {
  return {
    setup(): Promise<void> {
      // A malformed URL fails at startup, not on the first upload.
      if (!URL.canParse(api.base)) return Promise.reject(new Error("baseUrl is not a valid URL"));
      return Promise.resolve();
    },
    async health(): Promise<AdapterHealth> {
      try {
        await httpStatus(`${api.base}/v1/health`, { ...api.request(), retries: 1 });
        return { ok: true };
      } catch {
        return { ok: false, detail: "key-value service unreachable" }; // never the thrown error
      }
    },
    teardown: () => Promise.resolve(), // nothing is held open
  };
}

/** The seven object operations of a `StorageAdapter`. */
function kvObjects(api: KvApi): Omit<StorageAdapter, "metadata" | "lifecycle" | "setLogger"> {
  const read = async (path: string): Promise<Buffer> => {
    // A missing object is a 404 `HttpError`, which rejects: that is the contract.
    const body = await httpJson<{ data: string }>(api.objectUrl(path), api.request());
    return Buffer.from(body.data, "base64");
  };
  const write = async (path: string, data: Buffer): Promise<void> => {
    const json = { data: data.toString("base64") };
    await httpText(api.objectUrl(path), { ...api.request(), method: "PUT", json });
  };
  return {
    read,
    write,
    exists: async (path) => await existsAt(api, path),
    delete: async (path) => await deleteAt(api, path),
    async list(prefix): Promise<string[]> {
      const url = `${api.base}/v1/objects?prefix=${encodeURIComponent(prefix)}`;
      return (await httpJson<{ keys: string[] }>(url, api.request())).keys;
    },
    async writeStream(path, stream): Promise<void> {
      // Collect first: a stream that fails midway never reaches `write`, so no partial object.
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
      await write(path, Buffer.concat(chunks));
    },
    readStream: async (path) => Readable.from([await read(path)]),
  };
}

async function existsAt(api: KvApi, path: string): Promise<boolean> {
  try {
    await httpStatus(api.objectUrl(path), { ...api.request(), method: "HEAD" });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function deleteAt(api: KvApi, path: string): Promise<void> {
  try {
    await httpText(api.objectUrl(path), { ...api.request(), method: "DELETE" });
  } catch (error) {
    if (!isNotFound(error)) throw error; // deleting what is not there succeeds
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}

/** Refuse a path that climbs out of its prefix; keys are relative, `/`-separated. */
function safe(path: string): string {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`Unsafe storage path: ${path}`);
  }
  return path;
}
