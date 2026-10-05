import { createHash } from "node:crypto";
import { ICON_PATHS, type IconName } from "./paths.ts";

/** Assembled `<svg>` sprite of `<symbol id="i-<name>">` entries. */
export function buildSprite(paths: Record<string, string> = ICON_PATHS): string {
  const symbols = Object.entries(paths)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`;
}

/** Short content digest, used in asset URLs so a changed icon set busts caches. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 10);
}

/** The icon sprite and its content-addressed URL (computed once at load). */
export const iconSprite = buildSprite();
export const iconSpriteHash = contentHash(iconSprite);
export const iconSpriteHref = `/assets/icons-${iconSpriteHash}.svg`;

/** URL of one icon inside the cached sprite (`<use href>` target). */
export function iconHref(name: IconName): string {
  return `${iconSpriteHref}#i-${name}`;
}
