import { isPathSafe, mimeFor } from "@storyshelf/core/utils";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, normalize } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const compress = promisify(gzip);
const MAX_COMPRESS_FILE = 512 * 1024;
const MAX_COMPRESS_CACHE = 4 * 1024 * 1024;

/** Optional settings for the capture-only server. */
export interface StaticServerOptions {
  /** Precompress small text assets with gzip when accepted; disabled by default. */
  compression?: boolean | undefined;
}

/** A local HTTP server serving a built Storybook directory for capture. */
export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Serve a built Storybook directory over HTTP on 127.0.0.1 for capture.
 *
 * @param rootDir - Directory containing the built Storybook (`index.html` entry).
 * @returns The server URL and a `close` function to stop it.
 */
export async function createStaticServer(
  rootDir: string,
  options: StaticServerOptions = {},
): Promise<StaticServer> {
  const root = normalize(rootDir);
  const info = await stat(root).catch(() => null);
  if (!info || !info.isDirectory()) {
    throw new Error(
      `Storybook directory not found: ${rootDir}. Upload the built Storybook before capturing.`,
    );
  }

  const cache = new CompressionCache();
  const server = createServer((req, res) => {
    handleRequest(root, req, res, options.compression === true ? cache : undefined).catch(() => {
      sendNotFound(res);
    });
  });

  const port = await listen(server);

  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await closeServer(server);
    },
  };
}

function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}

async function resolveFile(root: string, urlPath: string): Promise<string | null> {
  const clean = (urlPath.split("?")[0] ?? "/").replace(/^\/+/u, "");
  const target = normalize(join(root, clean === "" ? "index.html" : clean));
  if (!isPathSafe(root, target)) {
    return null;
  }
  const info = await stat(target).catch(() => null);
  if (!info) {
    return null;
  }
  if (info.isDirectory()) {
    return resolveFile(root, `${clean}/index.html`);
  }
  return info.isFile() ? target : null;
}

async function handleRequest(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
  cache: CompressionCache | undefined,
): Promise<void> {
  const file = await resolveFile(root, req.url ?? "/");
  if (!file) {
    sendNotFound(res);
    return;
  }
  // This origin is private to a single capture run and its Storybook directory
  // is immutable for that run. Reused browser contexts can therefore cache all
  // successful responses without keeping a cache across builds.
  const zipped =
    cache && acceptsGzip(req.headers["accept-encoding"]) && isCompressible(mimeFor(file))
      ? await cache.get(file)
      : undefined;
  res.writeHead(200, {
    "content-type": mimeFor(file),
    "cache-control": "public, max-age=3600",
    ...(cache ? { vary: "Accept-Encoding" } : {}),
    ...(zipped ? { "content-encoding": "gzip", "content-length": zipped.length } : {}),
  });
  if (zipped) {
    res.end(zipped);
    return;
  }
  createReadStream(file).pipe(res);
}

function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false;
  const values = header.split(",").map((part) => part.trim().split(";"));
  const gzipEntry = values.find(([name]) => name?.trim().toLowerCase() === "gzip");
  const entry = gzipEntry ?? values.find(([name]) => name?.trim() === "*");
  if (!entry) return false;
  const quality = entry.slice(1).find((part) => /^\s*q\s*=/iu.test(part));
  if (quality === undefined) return true;
  const value = Number(quality.split("=")[1]);
  return Number.isFinite(value) && value > 0 && value <= 1;
}

function isCompressible(mime: string): boolean {
  return /^(?:text\/|application\/(?:javascript|json|xml|wasm)|image\/svg\+xml)/iu.test(mime);
}

/** Budget reservations include in-flight reads so concurrent requests stay bounded. */
class CompressionCache {
  private readonly entries = new Map<string, Promise<Buffer | undefined>>();
  private reserved = 0;

  async get(file: string): Promise<Buffer | undefined> {
    const existing = this.entries.get(file);
    if (existing) return await existing;
    const size = (await stat(file)).size;
    // Another request can populate the cache while stat is pending.
    const pending = this.entries.get(file);
    if (pending) return await pending;
    if (size > MAX_COMPRESS_FILE || this.reserved + size > MAX_COMPRESS_CACHE) return undefined;
    this.reserved += size;
    const result = this.encode(file, size);
    this.entries.set(file, result);
    return await result;
  }

  private async encode(file: string, size: number): Promise<Buffer | undefined> {
    try {
      const compressed = await compress(await readFile(file));
      if (compressed.length < size) return compressed;
    } catch {
      // Fall back to the original file if compression fails.
    }
    this.reserved -= size;
    this.entries.delete(file);
    return undefined;
  }
}

async function listen(server: Server): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
