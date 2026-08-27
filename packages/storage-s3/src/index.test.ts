import { describe, expect, it } from "vitest";

import { createS3Storage, s3Key } from "./index.ts";

describe("s3Key", () => {
  it("joins a prefix and path into an S3 key", () => {
    expect(s3Key("", "a/b.txt")).toBe("a/b.txt");
    expect(s3Key("app", "a/b.txt")).toBe("app/a/b.txt");
    expect(s3Key("app", "")).toBe("app/");
  });
});

describe("createS3Storage", () => {
  it("constructs a StorageAdapter without throwing", () => {
    const storage = createS3Storage({
      bucket: "test-bucket",
      prefix: "app",
      endpoint: "http://localhost:9000",
      region: "us-east-1",
    });

    expect(storage).toBeDefined();
    expect(typeof storage.read).toBe("function");
    expect(typeof storage.write).toBe("function");
    expect(typeof storage.delete).toBe("function");
    expect(typeof storage.exists).toBe("function");
    expect(typeof storage.list).toBe("function");
  });
});
