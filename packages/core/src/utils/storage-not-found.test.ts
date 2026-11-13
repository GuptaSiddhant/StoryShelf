import { describe, expect, it } from "vitest";
import { isStorageNotFound } from "./storage-not-found.ts";

describe("isStorageNotFound", () => {
  it.each([
    ["local", Object.assign(new Error("x"), { code: "ENOENT" })],
    ["s3 status", { $metadata: { httpStatusCode: 404 } }],
    ["s3 name", { name: "NoSuchKey" }],
    ["azure status", { statusCode: 404 }],
    ["azure code", { code: "BlobNotFound" }],
    ["gcs numeric", { code: 404 }],
    ["gcs string", { code: "404" }],
    ["gcs reason", { errors: [{ reason: "notFound" }] }],
  ])("recognises %s", (_name, error) => {
    expect(isStorageNotFound(error)).toBe(true);
  });

  it.each([
    ["a plain error", new Error("boom")],
    ["access denied", { $metadata: { httpStatusCode: 403 } }],
    ["a timeout", Object.assign(new Error("x"), { code: "ETIMEDOUT" })],
    ["a string", "ENOENT"],
    ["null", null],
  ])("does not treat %s as missing", (_name, error) => {
    expect(isStorageNotFound(error)).toBe(false);
  });
});
