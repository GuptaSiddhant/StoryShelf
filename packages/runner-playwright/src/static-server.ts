import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function mimeFor(file: string): string {
  return MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}

async function resolveFile(root: string, urlPath: string): Promise<string | null> {
  const clean = (urlPath.split("?")[0] ?? "/").replace(/^\/+/u, "");
  const target = normalize(join(root, clean === "" ? "index.html" : clean));
  if (target !== root && !target.startsWith(root + sep)) {
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

async function handleRequest(root: string, url: string, res: ServerResponse): Promise<void> {
  const file = await resolveFile(root, url);
  if (!file) {
    sendNotFound(res);
    return;
  }
  res.writeHead(200, { "content-type": mimeFor(file) });
  createReadStream(file).pipe(res);
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

export async function createStaticServer(rootDir: string): Promise<StaticServer> {
  const root = normalize(rootDir);
  const info = await stat(root).catch(() => null);
  if (!info || !info.isDirectory()) {
    throw new Error(`Storybook directory not found: ${rootDir}. Upload the built Storybook before capturing.`);
  }

  const server = createServer((req, res) => {
    handleRequest(root, req.url ?? "/", res).catch(() => {
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
