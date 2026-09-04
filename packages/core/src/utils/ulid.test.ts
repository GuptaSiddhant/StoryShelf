import { describe, expect, it } from "vitest";
import { slugify, ulid } from "./ulid.ts";

describe("ulid", () => {
  it("generates 26-char URL-safe ids", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/u);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => ulid()));
    expect(ids.size).toBe(100);
  });
});

describe("slugify", () => {
  it("slugifies names", () => {
    expect(slugify("Design System")).toBe("design-system");
    expect(slugify("ACME/Components")).toBe("acme-components");
    expect(slugify("  Foo  Bar  ")).toBe("foo-bar");
  });
});
