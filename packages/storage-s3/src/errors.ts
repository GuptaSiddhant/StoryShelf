/** Not-found and stream type guards for S3 responses. */
import { S3ServiceException } from "@aws-sdk/client-s3";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

/** True when the error is an S3 404 (missing object). */
export function isNotFound(error: unknown): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404;
}

/** True when an S3 `Body` is a WHATWG web stream rather than a Node stream. */
export function isWebStream(body: unknown): body is NodeWebStream {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { getReader?: unknown }).getReader === "function"
  );
}
