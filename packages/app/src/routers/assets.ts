import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { assetManifest } from "../asset-manifest.ts";

const IMMUTABLE = "public, max-age=31536000, immutable";

interface Asset {
  source: string;
  hash: string;
  contentType: string;
}

/**
 * Serve a content-addressed asset. A matching hash is cacheable forever and
 * answers conditional requests with 304; a stale hash (an old page still
 * open after an upgrade) gets the current content but is never cached under
 * the old URL.
 */
function serveHashed(c: Context, asset: Asset, requestedHash: string): Response {
  const etag = `"${asset.hash}"`;
  if (requestedHash !== asset.hash) {
    return c.body(asset.source, 200, {
      "content-type": asset.contentType,
      "cache-control": "no-store",
    });
  }
  if (c.req.header("if-none-match") === etag) {
    return c.body(null, 304, { etag, "cache-control": IMMUTABLE });
  }
  return c.body(asset.source, 200, {
    "content-type": asset.contentType,
    "cache-control": IMMUTABLE,
    etag,
  });
}

/** Register the static-asset routes (HTMX bundle and icon sprite). */
export function registerAssets(app: ShelfRouter): void {
  const { htmx, icons } = assetManifest;
  app.get(String.raw`/assets/:file{htmx-[a-f0-9]+\.js}`, (c) => {
    const hash = (c.req.param("file") ?? "").replaceAll(/^htmx-|\.js$/gu, "");
    return serveHashed(c, { ...htmx, contentType: "application/javascript" }, hash);
  });
  app.get(String.raw`/assets/:file{icons-[a-f0-9]+\.svg}`, (c) => {
    const hash = (c.req.param("file") ?? "").replaceAll(/^icons-|\.svg$/gu, "");
    return serveHashed(c, { ...icons, contentType: "image/svg+xml" }, hash);
  });
  // Legacy unversioned URL: kept for old pages and external embeds, but
  // revalidated (never immutable) because its content can change.
  app.get("/assets/htmx.js", (c) => {
    return c.body(htmx.source, 200, {
      "content-type": "application/javascript",
      "cache-control": "no-cache",
      etag: `"${htmx.hash}"`,
    });
  });
}
