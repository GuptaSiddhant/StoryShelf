import type { ShelfRouter } from "../app-types.ts";
import { assetManifest } from "../asset-manifest.ts";
import { getStore } from "../store.ts";
import { LIGHT_THEME } from "../ui/theme.ts";

/** Where the web app manifest is served (ADR 0048). */
export const MANIFEST_PATH = "/manifest.webmanifest";

/** The manifest document: installable as a standalone window, colours from the theme tokens. */
export function webManifest(name: string, light = LIGHT_THEME): Record<string, unknown> {
  const { mark, maskable } = assetManifest;
  return {
    name,
    short_name: name,
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: light.surface.base,
    background_color: light.surface.base,
    icons: [
      { src: mark.href, sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: mark.href, sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: maskable.href, sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}

/** Register `GET /manifest.webmanifest` (class `hosting`; needs no session). */
export function registerManifest(app: ShelfRouter): void {
  app.get(MANIFEST_PATH, (c) => {
    const { ui } = getStore();
    const body = JSON.stringify(webManifest(ui.name ?? "StoryShelf", ui.lightTheme));
    return c.body(body, 200, {
      "content-type": "application/manifest+json",
      "cache-control": "no-cache",
    });
  });
}
