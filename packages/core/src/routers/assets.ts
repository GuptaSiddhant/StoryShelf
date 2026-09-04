import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { ShelfApp } from "../index.tsx";

let htmxSource: string | null = null;

async function htmxScript(): Promise<string> {
  htmxSource ??= await readFile(fileURLToPath(new URL("../assets/htmx.min.js", import.meta.url)), "utf8");
  return htmxSource;
}

/** Register the vendored static-asset routes (HTMX bundle). */
export function registerAssets(app: ShelfApp): void {
  app.get("/assets/htmx.js", async (c) => {
    const body = await htmxScript();
    return c.body(body, 200, {
      "content-type": "application/javascript",
      "cache-control": "public, max-age=31536000, immutable",
    });
  });
}