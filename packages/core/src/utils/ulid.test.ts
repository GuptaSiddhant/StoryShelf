import { afterEach, describe, expect, it, vi } from "vitest";
import { slugify, ulid } from "./ulid.ts";

const forced = vi.hoisted(() => ({ bytes: undefined as Buffer | undefined }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomBytes: (size: number) => forced.bytes ?? actual.randomBytes(size),
  };
});

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

describe("ulid monotonic order", () => {
  afterEach(() => {
    vi.useRealTimers();
    forced.bytes = undefined;
  });

  it("sorts ids made in one millisecond in creation order", () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const ids = Array.from({ length: 1000 }, () => ulid());
    // Strictly increasing: sorted, and no duplicates.
    expect(ids.every((id, index) => index === 0 || id > (ids[index - 1] ?? ""))).toBe(true);
  });

  it("keeps order when the clock steps back", () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const first = ulid();
    vi.setSystemTime(1_799_999_999_000);
    expect(ulid() > first).toBe(true);
  });

  it("starts a fresh random part in a later millisecond", () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const first = ulid();
    vi.setSystemTime(1_800_000_000_001);
    const second = ulid();
    expect(second > first).toBe(true);
    expect(second.slice(0, 10) > first.slice(0, 10)).toBe(true);
  });

  it("carries into higher bits of the random part", () => {
    vi.useFakeTimers({ now: 1_800_000_001_000 });
    forced.bytes = Buffer.from("00000000ffffffffffff", "hex");
    const before = ulid();
    const after = ulid();
    expect(after > before).toBe(true);
  });

  it("throws when the random part overflows within one millisecond", () => {
    vi.useFakeTimers({ now: 1_800_000_002_000 });
    forced.bytes = Buffer.alloc(10, 0xff);
    ulid();
    expect(() => ulid()).toThrow(/overflow/u);
  });
});

describe("slugify", () => {
  it("slugifies names", () => {
    expect(slugify("Design System")).toBe("design-system");
    expect(slugify("ACME/Components")).toBe("acme-components");
    expect(slugify("  Foo  Bar  ")).toBe("foo-bar");
  });
});
