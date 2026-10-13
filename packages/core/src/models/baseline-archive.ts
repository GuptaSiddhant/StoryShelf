/**
 * Baseline archive format (v1): a zip holding `manifest.json` plus one PNG per
 * baseline at `baselines/<branch>/<storyId>/<mode>.png` — the storage layout
 * minus the instance-specific project id. The manifest is the source of truth
 * on import; file names inside the zip are only lookup keys and are never used
 * to build storage paths.
 */
import { z } from "zod";
import { modeSegment } from "../utils/paths.ts";

/** Identifies a StoryShelf baseline archive. */
export const BASELINE_ARCHIVE_FORMAT = "storyshelf-baselines";
/** Current archive format version. */
export const BASELINE_ARCHIVE_VERSION = 1;
/** Name of the manifest entry at the archive root. */
export const BASELINE_MANIFEST_NAME = "manifest.json";

/** Hard limits for archives (both directions). Zip64 is unsupported, so entries stay < 65535. */
export const BASELINE_ARCHIVE_LIMITS = {
  /** Maximum baselines in one archive. */
  maxBaselines: 50_000,
  /** Maximum size of one baseline PNG. */
  maxImageBytes: 64 * 1024 * 1024,
  /** Maximum size of `manifest.json`. */
  maxManifestBytes: 32 * 1024 * 1024,
  /** Maximum combined uncompressed size of an imported archive. */
  maxTotalBytes: 4 * 1024 * 1024 * 1024 - 1,
} as const;

const isoTimestamp = z.iso.datetime({ offset: true });

/** One baseline in the manifest. */
export const baselineManifestEntrySchema = z.object({
  storyId: z.string().min(1).max(512),
  viewport: z.string().min(1).max(256),
  browser: z.string().min(1).max(64),
  branch: z.string().min(1).max(512),
  mode: z.string().max(65_536).nullable(),
  infraHash: z.string().max(512).nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  /** Zip entry holding the PNG. */
  file: z.string().min(1).max(2048),
  /** Lowercase hex SHA-256 of the PNG bytes. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

/** Identity of a baseline the export could not read (listed, not archived). */
export const baselineSkippedSchema = baselineManifestEntrySchema.pick({
  storyId: true,
  viewport: true,
  browser: true,
  branch: true,
});

/** Archive manifest (`manifest.json`). */
export const baselineManifestSchema = z.object({
  format: z.literal(BASELINE_ARCHIVE_FORMAT),
  version: z.literal(BASELINE_ARCHIVE_VERSION),
  exportedAt: isoTimestamp,
  /** Source project slug (informational). */
  project: z.string().nullable(),
  /** Branch filter used by the export; null means every branch. */
  branch: z.string().nullable(),
  baselines: z.array(baselineManifestEntrySchema).max(BASELINE_ARCHIVE_LIMITS.maxBaselines),
  skipped: z.array(baselineSkippedSchema).optional(),
});

/** One baseline in the manifest. */
export type BaselineManifestEntry = z.infer<typeof baselineManifestEntrySchema>;
/** Archive manifest. */
export type BaselineManifest = z.infer<typeof baselineManifestSchema>;
/** Identity of a baseline the export skipped. */
export type BaselineSkipped = z.infer<typeof baselineSkippedSchema>;

/** An archive that is malformed, unsafe, over a limit, or inconsistent with its manifest. */
export class BaselineArchiveError extends Error {
  override readonly name = "BaselineArchiveError";
}

/** Zip entry name for a baseline, mirroring the storage layout without the project id. */
export function archiveFileName(
  branch: string,
  storyId: string,
  viewport: string,
  browser: string,
): string {
  return `baselines/${branch}/${storyId}/${modeSegment(viewport, browser)}.png`;
}

/** Stable identity key of a baseline (story, mode, browser, branch). */
export function baselineIdentity(entry: BaselineSkipped): string {
  return JSON.stringify([entry.storyId, entry.viewport, entry.browser, entry.branch]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Whether `data` starts with the PNG file signature. */
export function isPng(data: Buffer): boolean {
  return data.length >= PNG_SIGNATURE.length && data.subarray(0, 8).equals(PNG_SIGNATURE);
}
