/**
 * Storage adapter interface: binary objects for screenshots, diffs, and archives.
 */
import type { Buffer } from "node:buffer";
import type { AdapterMetadata } from "./metadata.ts";

/** Blob storage abstraction for screenshots, diffs and Storybook archives. */
export interface StorageAdapter {
  /** Adapter identity. */
  readonly metadata?: AdapterMetadata;
  /** Read the bytes stored at `path`. */
  read(path: string): Promise<Buffer>;
  /** Write `data` to `path`, creating parent directories as needed. */
  write(path: string, data: Buffer): Promise<void>;
  /** Delete the object at `path` if it exists. */
  delete(path: string): Promise<void>;
  /** Return whether an object exists at `path`. */
  exists(path: string): Promise<boolean>;
  /** List object paths under the given key prefix. */
  list(prefix: string): Promise<string[]>;
}
