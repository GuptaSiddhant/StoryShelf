/** Key join/split tests for S3 object keys. */
import { describe, expect, it } from "vitest";
import { s3Key, s3Rel } from "./keys.ts";

describe("s3Key", () => {
  it("joins a prefix and path into an S3 key", () => {
    expect(s3Key("", "a/b.txt")).toBe("a/b.txt");
    expect(s3Key("app", "a/b.txt")).toBe("app/a/b.txt");
    expect(s3Key("app", "")).toBe("app/");
  });
});

describe("s3Rel", () => {
  it("strips the prefix back off a listed key", () => {
    expect(s3Rel("", "a/b.txt")).toBe("a/b.txt");
    expect(s3Rel("app", "app/a/b.txt")).toBe("a/b.txt");
  });
});
