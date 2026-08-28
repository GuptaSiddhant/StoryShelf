import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Hono } from "hono";

let htmxSource: string | null = null;

async function htmxScript(): Promise<string> {
  htmxSource ??= await readFile(fileURLToPath(new URL("../assets/htmx.min.js", import.meta.url)), "utf8");
  return htmxSource;
}

export function registerAssets(app: Hono): void {
  app.get("/assets/htmx.js", async (c) => {
    const body = await htmxScript();
    return c.body(body, 200, {
      "content-type": "application/javascript",
      "cache-control": "public, max-age=31536000, immutable",
    });
  });
}