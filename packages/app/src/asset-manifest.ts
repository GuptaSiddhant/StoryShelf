import { htmxSource } from "./assets/htmx.ts";
import { maskableMarkSource } from "./assets/mark-maskable.ts";
import { faviconSource, markSource } from "./assets/mark.ts";
import { clientScript } from "./shell/client-script.ts";
import { contentHash, iconSprite, iconSpriteHash, iconSpriteHref } from "./ui/icons/sprite.ts";

/**
 * Static assets with content-addressed URLs. A URL that embeds the content
 * hash may be cached forever (`immutable`): changing the file changes the
 * URL. The sources are modules under `assets/` (embedded in the bundle, nothing to locate at
 * runtime) and are hashed once at load so the page shell can reference the URLs.
 */
const htmxHash = contentHash(htmxSource);

/** The StoryShelf mark on its tile: the default sidebar logo when `ui.logo` is not set. */
const markHash = contentHash(markSource);

/** The bare mark that follows the browser's colour scheme: the enforced favicon. */
const faviconHash = contentHash(faviconSource);
/** The same mark with a full-bleed background and safe-zone padding: the maskable app icon. */
const maskableHash = contentHash(maskableMarkSource);

/** The shell's interactive behaviour; static, so it is served as a cacheable file. */
const clientSource = clientScript();
const clientHash = contentHash(clientSource);

export const assetManifest = {
  favicon: { source: faviconSource, hash: faviconHash, href: `/assets/favicon-${faviconHash}.svg` },
  client: { source: clientSource, hash: clientHash, href: `/assets/client-${clientHash}.js` },
  htmx: { source: htmxSource, hash: htmxHash, href: `/assets/htmx-${htmxHash}.js` },
  icons: { source: iconSprite, hash: iconSpriteHash, href: iconSpriteHref },
  maskable: {
    source: maskableMarkSource,
    hash: maskableHash,
    href: `/assets/mark-maskable-${maskableHash}.svg`,
  },
  mark: { source: markSource, hash: markHash, href: `/assets/mark-${markHash}.svg` },
} as const;
