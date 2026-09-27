/**
 * Storage adapter wrapper: one span + duration metric per operation.
 *
 * Span names are `storage.<operation>` with the path as an attribute.
 * Metrics carry the operation only (paths are high-cardinality and stay
 * out of metric attributes). Identity, lifecycle, and logger delegate
 * straight through.
 */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Logger } from "@storyshelf/core/logger";
import type { Buffer } from "node:buffer";
import type { Readable } from "node:stream";
import { storageMetrics } from "./metrics.ts";
import { withSpan } from "./tracing.ts";

/**
 * Wrap a storage adapter with per-operation spans and metrics.
 *
 * @param storage - The adapter to wrap (never mutated).
 * @returns A transparent adapter emitting `storage.*` telemetry.
 */
export function createInstrumentedStorage(storage: StorageAdapter): StorageAdapter {
  return new InstrumentedStorage(storage);
}

class InstrumentedStorage implements StorageAdapter {
  constructor(private readonly inner: StorageAdapter) {}

  get metadata(): StorageAdapter["metadata"] {
    return this.inner.metadata;
  }

  get lifecycle(): StorageAdapter["lifecycle"] {
    return this.inner.lifecycle;
  }

  setLogger(logger: Logger): void {
    this.inner.setLogger?.(logger);
  }

  async read(path: string): Promise<Buffer> {
    return await track("storage.read", path, async () => await this.inner.read(path));
  }

  async write(path: string, data: Buffer): Promise<void> {
    await track("storage.write", path, async () => {
      await this.inner.write(path, data);
    });
  }

  async delete(path: string): Promise<void> {
    await track("storage.delete", path, async () => {
      await this.inner.delete(path);
    });
  }

  async exists(path: string): Promise<boolean> {
    return await track("storage.exists", path, async () => await this.inner.exists(path));
  }

  async list(prefix: string): Promise<string[]> {
    return await track("storage.list", prefix, async () => await this.inner.list(prefix));
  }

  async writeStream(path: string, stream: Readable): Promise<void> {
    await track("storage.writeStream", path, async () => {
      await this.inner.writeStream(path, stream);
    });
  }

  async readStream(path: string): Promise<Readable> {
    return await track("storage.readStream", path, async () => await this.inner.readStream(path));
  }
}

/** Run a storage operation inside a span with a duration measurement. */
async function track<T>(operation: string, path: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await withSpan(operation, fn, { "storage.path": path });
  } finally {
    storageMetrics().operationDuration.record(performance.now() - start, {
      "storage.operation": operation,
    });
  }
}
