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
  const base = options.baseUrl.replace(/\/+$/u, "");
  const headers = { authorization: `Bearer ${options.token}` };
  let logger = options.logger?.child({ component: "storage-kv" });
  const objectUrl = (path: string): string =>
    `${base}/v1/objects/${encodeURIComponent(safe(path))}`;
  const request = (): { headers: Record<string, string>; logger: Logger | undefined } => ({
    headers,
    logger,
  });

  async function read(path: string): Promise<Buffer> {
    // A missing object is a 404 `HttpError`, which rejects: that is the contract.
    const body = await httpJson<{ data: string }>(objectUrl(path), request());
    return Buffer.from(body.data, "base64");
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await httpStatus(objectUrl(path), { ...request(), method: "HEAD" });
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  return {
    metadata: {
      name: "Key-value storage",
      version: "0.0.0",
      kind: "kv-http",
      category: "storage",
    },
    setLogger(bound): void {
      logger = (options.logger ?? bound).child({ component: "storage-kv" });
    },
    lifecycle: {
      async setup(): Promise<void> {
        new URL(base); // throws on a malformed URL, so a bad config fails at startup
      },
      async health() {
        try {
          await httpStatus(`${base}/v1/health`, { ...request(), retries: 1 });
          return { ok: true };
        } catch {
          return { ok: false, detail: "key-value service unreachable" };
        }
      },
      async teardown(): Promise<void> {
        // Nothing is held open, so a second call is as harmless as the first.
      },
    },
    read,
    exists,
    async write(path, data): Promise<void> {
      const json = { data: data.toString("base64") };
      await httpText(objectUrl(path), { ...request(), method: "PUT", json });
    },
    async delete(path): Promise<void> {
      try {
        await httpText(objectUrl(path), { ...request(), method: "DELETE" });
      } catch (error) {
        if (!isNotFound(error)) throw error; // deleting what is not there succeeds
      }
    },
    async list(prefix): Promise<string[]> {
      const query = encodeURIComponent(prefix);
      const body = await httpJson<{ keys: string[] }>(
        `${base}/v1/objects?prefix=${query}`,
        request(),
      );
      return body.keys;
    },
    async writeStream(path, stream): Promise<void> {
      // Collect first: a stream that fails midway never reaches `write`, so no partial object.
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
      await this.write(path, Buffer.concat(chunks));
    },
    async readStream(path): Promise<Readable> {
      return Readable.from([await read(path)]);
    },
  };
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
