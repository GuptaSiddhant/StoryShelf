/** Key join/split for GCS object keys. */

/** Join an optional key prefix with a storage path. */
export function gcsKey(prefix: string, path: string): string {
  return prefix === "" ? path : `${prefix}/${path}`;
}

/** Strip a key prefix from a full GCS object name (inverse of gcsKey). */
export function gcsRel(prefix: string, key: string): string {
  return prefix === "" ? key : key.slice(prefix.length + 1);
}
