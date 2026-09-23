import { describe, expect, it } from "vitest";
import { gcsKey, gcsRel } from "./keys.ts";

describe("gcsKey", () => {
  it("joins a prefix and path into a GCS key", () => {
    expect(gcsKey("", "a/b.txt")).toBe("a/b.txt");
    expect(gcsKey("app", "a/b.txt")).toBe("app/a/b.txt");
    expect(gcsKey("app", "")).toBe("app/");
  });

  it("round-trips through the inverse split", () => {
    expect(gcsRel("app", gcsKey("app", "a/b.txt"))).toBe("a/b.txt");
    expect(gcsRel("", gcsKey("", "a/b.txt"))).toBe("a/b.txt");
  });
});
