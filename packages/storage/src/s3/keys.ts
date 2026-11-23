/** Key join/split for S3 object keys under an optional prefix. */

/** Join an optional key prefix with a storage path. */
export function s3Key(prefix: string, path: string): string {
  return prefix === "" ? path : `${prefix}/${path}`;
}

/** Strip the configured prefix back off a listed S3 key. */
export function s3Rel(prefix: string, key: string): string {
  return prefix === "" ? key : key.slice(prefix.length + 1);
}
