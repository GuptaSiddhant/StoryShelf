/** Key join/split tests for Azure blob names. */
import { describe, expect, it } from "vitest";
import { azureKey, azureRel } from "./keys.ts";

describe("azureKey", () => {
  it("joins a prefix and path into a blob name", () => {
    expect(azureKey("", "a/b.txt")).toBe("a/b.txt");
    expect(azureKey("app", "a/b.txt")).toBe("app/a/b.txt");
    expect(azureKey("app", "")).toBe("app/");
  });
});

describe("azureRel", () => {
  it("strips the prefix back off a listed blob name", () => {
    expect(azureRel("", "a/b.txt")).toBe("a/b.txt");
    expect(azureRel("app", "app/a/b.txt")).toBe("a/b.txt");
  });
});
