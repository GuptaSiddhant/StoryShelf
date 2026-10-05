import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "./paths.ts";
import { buildSprite, contentHash, iconHref, iconSpriteHref } from "./sprite.ts";

describe("icon sprite", () => {
  it("builds one symbol per icon, sorted for a stable hash", () => {
    const sprite = buildSprite({ b: "<path/>", a: "<circle/>" });
    expect(sprite.indexOf('id="i-a"')).toBeLessThan(sprite.indexOf('id="i-b"'));
    expect(buildSprite({ a: "<circle/>", b: "<path/>" })).toBe(sprite);
  });

  it("changes the hash when an icon changes", () => {
    expect(contentHash(buildSprite({ a: "<path/>" }))).not.toBe(
      contentHash(buildSprite({ a: "<path d='M0 0'/>" })),
    );
  });

  it("points <use> at a symbol inside the hashed sprite URL", () => {
    expect(iconSpriteHref).toMatch(/^\/assets\/icons-[a-f0-9]{10}\.svg$/u);
    expect(iconHref("check")).toBe(`${iconSpriteHref}#i-check`);
  });

  it("only uses stroke-based markup that inherits currentColor", () => {
    for (const body of Object.values(ICON_PATHS)) {
      expect(body).not.toMatch(/stroke="(?!none)/u);
    }
  });
});
