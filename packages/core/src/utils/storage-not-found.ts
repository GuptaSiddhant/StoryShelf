/** Telling "no such object" from a real storage failure, across every storage adapter. */

const NOT_FOUND_CODES = new Set([
  "ENOENT",
  "404",
  "NoSuchKey",
  "NotFound",
  "BlobNotFound",
  "notFound",
]);

/**
 * Whether `error` means the object is missing, as the local adapter (`ENOENT`), S3 (`404` /
 * `NoSuchKey`), Azure (`404` / `BlobNotFound`) and GCS (`404` / `notFound`) report it. Any other
 * error is a failure the caller must not treat as a miss.
 */
export function isStorageNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const err = error as {
    code?: unknown;
    name?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
    errors?: { reason?: unknown }[];
  };
  return (
    err.code === 404 ||
    err.statusCode === 404 ||
    err.$metadata?.httpStatusCode === 404 ||
    (typeof err.code === "string" && NOT_FOUND_CODES.has(err.code)) ||
    err.name === "NoSuchKey" ||
    err.errors?.[0]?.reason === "notFound"
  );
}
