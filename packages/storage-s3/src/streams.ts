/** Streaming reads and writes for S3 objects, with failure cleanup. */
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import type { S3Context } from "./client.ts";
import { isWebStream } from "./errors.ts";
import { s3Key } from "./keys.ts";

/** Multipart-upload a Node stream, deleting the partial key on failure. */
export async function s3WriteStream(ctx: S3Context, path: string, stream: Readable): Promise<void> {
  const upload = new Upload({
    client: ctx.client,
    params: { Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path), Body: stream },
  });
  try {
    await upload.done();
  } catch (error) {
    try {
      await ctx.client.send(
        new DeleteObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path) }),
      );
    } catch {
      // ignore cleanup failure - original error is rethrown
    }
    throw error;
  }
}

/** Open an object as a Node stream, converting web-stream bodies. */
export async function s3ReadStream(ctx: S3Context, path: string): Promise<Readable> {
  const response = await ctx.client.send(
    new GetObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path) }),
  );
  const body: unknown = response.Body;
  if (body instanceof Readable) {
    return body;
  }
  if (isWebStream(body)) {
    return Readable.fromWeb(body);
  }
  throw new Error(`No object at "${path}"`);
}
