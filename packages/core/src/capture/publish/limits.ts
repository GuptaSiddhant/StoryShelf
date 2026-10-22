/** Publish limits (ADR 0006, decision 10): the inline threshold and the extraction caps, with defaults. */
import type { ShelfConfig } from "../../config.ts";

/** Zip size (bytes) up to which a zip is extracted inline in the upload request: 50 MB. */
export const DEFAULT_MAX_INLINE_UNZIP_SIZE = 50 * 1024 * 1024;

/** Entries an uploaded Storybook zip may hold. A large Storybook has some thousands of files. */
export const DEFAULT_MAX_ZIP_ENTRIES = 50_000;

/** Total uncompressed bytes an uploaded Storybook zip may expand to: 2 GiB. */
export const DEFAULT_MAX_UNZIPPED_BYTES = 2 * 1024 * 1024 * 1024;

/** Caps enforced while a zip is extracted; the compressed size alone is no bound. */
export interface ExtractionLimits {
  /** Most entries (files and directories) the archive may hold. */
  maxEntries: number;
  /** Most uncompressed bytes all files together may expand to, counted while streaming. */
  maxBytes: number;
}

/** Everything the publish pipeline reads from `ShelfConfig`, defaults applied. */
export interface PublishLimits extends ExtractionLimits {
  /** Largest zip extracted inline in the upload request; `0` sends every zip to a `publish` job. */
  inlineBytes: number;
}

/** The effective publish limits of a config. */
export function resolvePublishLimits(
  config?: Pick<ShelfConfig, "maxInlineUnzipSize" | "maxZipEntries" | "maxUnzippedBytes">,
): PublishLimits {
  return {
    inlineBytes: config?.maxInlineUnzipSize ?? DEFAULT_MAX_INLINE_UNZIP_SIZE,
    maxEntries: config?.maxZipEntries ?? DEFAULT_MAX_ZIP_ENTRIES,
    maxBytes: config?.maxUnzippedBytes ?? DEFAULT_MAX_UNZIPPED_BYTES,
  };
}

/** The extraction caps alone. */
export function extractionLimitsOf(limits: PublishLimits | ExtractionLimits): ExtractionLimits {
  return { maxEntries: limits.maxEntries, maxBytes: limits.maxBytes };
}

/** How an upload of `zipBytes` is published: inline in the request, or by a `publish` job. */
export function publishRoute(
  zipBytes: number,
  limits: Pick<PublishLimits, "inlineBytes">,
): "inline" | "job" {
  return zipBytes <= limits.inlineBytes ? "inline" : "job";
}

/** An archive that breaks a cap or tries to write outside the target; retrying cannot help. */
export class ZipLimitError extends Error {
  override readonly name = "ZipLimitError";
}

/** Message of the 413 an over-limit zip gets on a host with no `publish` consumer. */
export const FILE_BY_FILE_HINT =
  "Zip is larger than the inline publish limit and this host runs no publish consumer. " +
  "Upload the Storybook file by file instead: POST /dedup, then PUT /content, then POST /manifest " +
  "(the storyshelf CLI does this when it is given a directory).";
