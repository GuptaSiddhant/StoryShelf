/** Buffered CRUD and paginated listing for S3 objects. */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3Context } from "./client.ts";
import { isNotFound } from "./errors.ts";
import { s3Key, s3Rel } from "./keys.ts";

/** Read one object fully into a buffer (empty when the body is missing). */
export async function s3Read(ctx: S3Context, path: string): Promise<Buffer> {
  const response = await ctx.client.send(
    new GetObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path) }),
  );
  const body = response.Body;
  if (body === undefined) {
    return Buffer.alloc(0);
  }
  return Buffer.from(await body.transformToByteArray());
}

/** Write one object from a buffer. */
export async function s3Write(ctx: S3Context, path: string, data: Buffer): Promise<void> {
  await ctx.client.send(
    new PutObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path), Body: data }),
  );
}

/** Delete one object. */
export async function s3Delete(ctx: S3Context, path: string): Promise<void> {
  await ctx.client.send(
    new DeleteObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path) }),
  );
}

/** True when the object exists; false on S3 404, rethrowing other errors. */
export async function s3Exists(ctx: S3Context, path: string): Promise<boolean> {
  try {
    await ctx.client.send(
      new HeadObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path) }),
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

/** List paths under a prefix, stripping the configured bucket prefix. */
export async function s3List(ctx: S3Context, listPrefix: string): Promise<string[]> {
  const prefix = s3Key(ctx.prefix, listPrefix);
  const results: string[] = [];
  let token: string | undefined;
  do {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pagination requires sequential awaits
    const response = await ctx.client.send(
      new ListObjectsV2Command({
        Bucket: ctx.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const item of response.Contents ?? []) {
      if (item.Key !== undefined) {
        results.push(s3Rel(ctx.prefix, item.Key));
      }
    }
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token !== undefined);
  return results;
}
