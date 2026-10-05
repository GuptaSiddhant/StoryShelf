import { readFileSync } from "node:fs";
import { findAsset } from "./asset-paths.ts";
import { contentHash, iconSprite, iconSpriteHash, iconSpriteHref } from "./ui/icons/sprite.ts";

/**
 * Static assets with content-addressed URLs. A URL that embeds the content
 * hash may be cached forever (`immutable`): changing the file changes the
 * URL. Loaded synchronously once so the page shell can reference the URLs.
 */
const htmxSource = readFileSync(findAsset("htmx.min.js", import.meta.url), "utf8");
const htmxHash = contentHash(htmxSource);

export const assetManifest = {
  htmx: { source: htmxSource, hash: htmxHash, href: `/assets/htmx-${htmxHash}.js` },
  icons: { source: iconSprite, hash: iconSpriteHash, href: iconSpriteHref },
} as const;
