import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { storageFromEnv, type StorageFactories } from "./storage.ts";

function factories() {
  const s3 = vi.fn((_options: unknown): StorageAdapter => makeStorage().storage);
  const local = vi.fn((_dataDir: string): StorageAdapter => makeStorage().storage);
  return { s3, local, set: { s3, local } satisfies StorageFactories };
}

describe("storageFromEnv", () => {
  it("uses S3 with the given endpoint and region when SHELF_S3_BUCKET is set", () => {
    const { s3, local, set } = factories();
    const chosen = storageFromEnv(
      {
        SHELF_S3_BUCKET: "demo-bucket",
        AWS_ENDPOINT_URL_S3: "https://t3.storage.dev/some/path?token=x",
        AWS_REGION: "eu-west-1",
      },
      "/data",
      set,
    );
    expect(s3).toHaveBeenCalledWith({
      bucket: "demo-bucket",
      endpoint: "https://t3.storage.dev/some/path?token=x",
      region: "eu-west-1",
    });
    expect(local).not.toHaveBeenCalled();
    expect(chosen.log).toEqual({ storage: "s3", endpointOrigin: "https://t3.storage.dev" });
  });

  it("defaults the region to auto, and an unset endpoint to the SDK's own", () => {
    const { s3, set } = factories();
    const chosen = storageFromEnv({ SHELF_S3_BUCKET: "demo-bucket" }, "/data", set);
    expect(s3).toHaveBeenCalledWith({ bucket: "demo-bucket", endpoint: undefined, region: "auto" });
    expect(chosen.log).toEqual({ storage: "s3", endpointOrigin: null });
  });

  it("still takes the old AWS_BUCKET and BUCKET_NAME (what `fly storage create` sets)", () => {
    const { s3, set } = factories();
    storageFromEnv({ BUCKET_NAME: "from-fly" }, "/data", set);
    storageFromEnv({ AWS_BUCKET: "explicit" }, "/data", set);
    storageFromEnv({ SHELF_S3_BUCKET: "same", BUCKET_NAME: "same" }, "/data", set);
    expect(s3.mock.calls.map(([options]) => (options as { bucket: string }).bucket)).toEqual([
      "from-fly",
      "explicit",
      "same",
    ]);
  });

  it("refuses two bucket names that disagree, naming both and neither value", () => {
    const { set } = factories();
    expect(() =>
      storageFromEnv({ SHELF_S3_BUCKET: "explicit", BUCKET_NAME: "from-fly" }, "/data", set),
    ).toThrow(
      "SHELF_S3_BUCKET and BUCKET_NAME are both set, to different values: set only SHELF_S3_BUCKET and unset BUCKET_NAME",
    );
  });

  it.each([{}, { SHELF_S3_BUCKET: "" }, { SHELF_S3_BUCKET: "" }, { SHELF_S3_BUCKET: undefined }])(
    "falls back to the volume when no bucket is set (%o)",
    (env) => {
      const { s3, local, set } = factories();
      const chosen = storageFromEnv(env, "/data", set);
      expect(local).toHaveBeenCalledWith("/data");
      expect(s3).not.toHaveBeenCalled();
      expect(chosen.log).toEqual({ storage: "local" });
    },
  );

  it("never reads or logs a credential, the bucket or a key", () => {
    const { s3, set } = factories();
    const chosen = storageFromEnv(
      {
        SHELF_S3_BUCKET: "secret-bucket-name",
        AWS_ENDPOINT_URL_S3: "https://t3.storage.dev",
        AWS_ACCESS_KEY_ID: "tid_AKIAEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "tsec_SUPERSECRET",
      },
      "/data",
      set,
    );
    expect(JSON.stringify(s3.mock.calls)).not.toMatch(/AKIAEXAMPLE|SUPERSECRET/u);
    expect(JSON.stringify(chosen.log)).not.toMatch(/secret-bucket-name|AKIAEXAMPLE|SUPERSECRET/u);
  });

  it("builds the real adapters by default", () => {
    expect(storageFromEnv({}, "/tmp/never-created").storage.metadata.kind).toBe("local");
    expect(
      storageFromEnv(
        { SHELF_S3_BUCKET: "b", AWS_ENDPOINT_URL_S3: "https://t3.storage.dev" },
        "/data",
      ).storage.metadata.kind,
    ).toBe("s3");
  });
});
