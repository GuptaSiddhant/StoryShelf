/** Minimal typings for the archiver v8 ESM surface used by the upload command. */
declare module "archiver" {
  import { Readable } from "node:stream";

  export declare class ZipArchive extends Readable {
    constructor(options?: { zlib?: { level?: number } });
    /** Add a directory tree; `destPath === false` stores relative paths. */
    directory(dirPath: string, destPath: string | false): this;
    /** Finalize the archive (stream keeps flowing until end). */
    finalize(): Promise<void>;
  }
}
