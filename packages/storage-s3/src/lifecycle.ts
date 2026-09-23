/** S3 bucket probe lifecycle: setup, health, and teardown. */
import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";

/** All-or-nothing lifecycle: probe bucket access, destroy owned clients. */
export function buildS3Lifecycle(
  client: S3Client,
  ownsClient: boolean,
  bucket: string,
  prefix: string,
): StorageAdapter["lifecycle"] {
  let destroyed = false;
  return {
    setup: async () => {
      await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }));
    },
    teardown: async () => {
      if (ownsClient && !destroyed) {
        destroyed = true;
        client.destroy();
      }
      await Promise.resolve();
    },
    health: async () => {
      await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }));
      return { ok: true };
    },
  };
}
