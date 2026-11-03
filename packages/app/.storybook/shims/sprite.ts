/**
 * Story-only stand-in for `src/ui/icons/sprite.ts`. The production module hashes the sprite with
 * `node:crypto` and serves it as a cached file; Storybook inlines the sprite in the page instead,
 * so `<use href="#i-name">` resolves without a request. Same names, same icon set.
 */
import { ICON_PATHS, type IconName } from "../../src/ui/icons/paths.ts";

export function buildSprite(paths: Record<string, string> = ICON_PATHS): string {
  const symbols = Object.entries(paths)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`;
}

export const iconSprite = buildSprite();
export const iconSpriteHash = "storybook";
export const iconSpriteHref = "";

export function contentHash(): string {
  return iconSpriteHash;
}

/** Same-document target: the sprite is inlined by `.storybook/preview.ts`. */
export function iconHref(name: IconName): string {
  return `#i-${name}`;
}
