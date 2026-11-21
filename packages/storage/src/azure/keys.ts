/** Key join/split for Azure blob names. */

/** Join an optional prefix with a storage path. */
export function azureKey(prefix: string, path: string): string {
  return prefix === "" ? path : `${prefix}/${path}`;
}

/** Strip a storage prefix back off a blob name. */
export function azureRel(prefix: string, key: string): string {
  return prefix === "" ? key : key.slice(prefix.length + 1);
}
