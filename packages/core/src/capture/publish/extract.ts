/**
 * Streaming, capped extraction of an uploaded Storybook zip into a directory. Entry count and
 * uncompressed bytes are counted while the archive streams (never from a header or from
 * `Content-Length`), and a path that leaves the target is refused.
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Parse, type Entry } from "unzipper";
import { ZipLimitError, type ExtractionLimits } from "./limits.ts";

/** What an extraction produced. */
export interface ExtractionResult {
  entries: number;
  bytes: number;
}

/**
 * Extract `source` (a zip stream) under `root`, which must exist.
 *
 * @throws {ZipLimitError} When a cap is exceeded or an entry path escapes `root`; the source is
 *   destroyed at once, and the files written so far are left for the caller's scratch cleanup.
 */
export async function extractZipStream(
  source: Readable,
  root: string,
  limits: ExtractionLimits,
): Promise<ExtractionResult> {
  const run = new Extraction(resolve(root), limits);
  const failure = await run.parse(source);
  // Writes may still be in flight after a failure; settle them before anyone removes the files.
  const outcomes = await Promise.allSettled(run.writes);
  if (failure) {
    throw failure;
  }
  const writeError = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (writeError) {
    throw writeError.reason;
  }
  return { entries: run.entries, bytes: run.bytes };
}

function ignore(): void {}

/** State of one extraction. */
class Extraction {
  entries = 0;
  bytes = 0;
  readonly writes: Promise<void>[] = [];
  readonly root: string;
  readonly limits: ExtractionLimits;
  #failed = false;
  #fail: (error: unknown) => void = ignore;

  constructor(root: string, limits: ExtractionLimits) {
    this.root = root;
    this.limits = limits;
  }

  /** Resolves with the first failure, or null once the archive was read to its end. */
  // oxlint-disable-next-line typescript/promise-function-async -- executor-style wrapper around stream events
  parse(source: Readable): Promise<unknown> {
    return new Promise((settle) => {
      const parser = Parse();
      this.#fail = (error: unknown): void => {
        if (!this.#failed) {
          this.#failed = true;
          source.destroy();
          parser.destroy();
          settle(error);
        }
      };
      parser.on("entry", (entry: Entry) => {
        this.#entry(entry);
      });
      parser.on("error", this.#fail);
      parser.on("close", () => {
        settle(null);
      });
      source.on("error", this.#fail);
      source.pipe(parser);
    });
  }

  #entry(entry: Entry): void {
    this.entries += 1;
    const problem = this.#problemWith(entry);
    if (problem) {
      this.#fail(problem);
    }
    if (this.#failed || entry.type === "Directory") {
      entry.autodrain();
      return;
    }
    this.#write(entry);
  }

  #problemWith(entry: Entry): ZipLimitError | null {
    if (this.entries > this.limits.maxEntries) {
      return new ZipLimitError(`Zip holds more than ${this.limits.maxEntries} entries`);
    }
    if (unsafePath(this.root, entry.path)) {
      return new ZipLimitError(`Blocked path traversal in uploaded Storybook: ${entry.path}`);
    }
    return null;
  }

  #write(entry: Entry): void {
    const target = join(this.root, entry.path);
    const done = (async (): Promise<void> => {
      await mkdir(dirname(target), { recursive: true });
      await pipeline(entry, this.#counter(), createWriteStream(target));
    })();
    this.writes.push(done);
    done.catch(ignore); // Aggregated through allSettled by the caller
  }

  /** Counts the bytes that pass; past the cap the whole extraction fails at once. */
  #counter(): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        this.bytes += chunk.length;
        if (this.bytes > this.limits.maxBytes) {
          const error = new ZipLimitError(`Zip expands beyond ${this.limits.maxBytes} bytes`);
          this.#fail(error);
          callback(error);
          return;
        }
        callback(null, chunk);
      },
    });
  }
}

/** Absolute paths, drive letters and anything resolving outside `root`. */
function unsafePath(root: string, entryPath: string): boolean {
  if (isAbsolute(entryPath) || /^[a-zA-Z]:/u.test(entryPath)) {
    return true;
  }
  const candidate = resolve(join(root, entryPath));
  return candidate !== root && !candidate.startsWith(root + sep);
}
