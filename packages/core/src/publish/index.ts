/**
 * Publishing, independent of capture (ADR 0006, decision 10): limits and caps, capped extraction,
 * the acceptance rule, the `publish` job handler and the end-of-publish completer with its
 * `afterPublish` hooks, the statics a published Storybook keeps, its content uses and the scratch
 * directories publishing (and capture) work in.
 */
export { createPublishHandler, type PublishHandlerOptions } from "./handler.ts";
export { publishVerdict, type PublishFacts } from "./accept.ts";
export { publishingOf, publishingOfBuild, type PublishingOptions } from "./published.ts";
export {
  createPublishCompleter,
  type AfterPublishContext,
  type AfterPublishHook,
  type PublishCompleter,
  type PublishCompleterOptions,
  type PublishOutcome,
} from "./complete.ts";
export { extractZipStream, type ExtractionResult } from "./extract.ts";
export {
  DEFAULT_MAX_INLINE_UNZIP_SIZE,
  DEFAULT_MAX_UNZIPPED_BYTES,
  DEFAULT_MAX_ZIP_ENTRIES,
  extractionLimitsOf,
  FILE_BY_FILE_HINT,
  publishRoute,
  resolvePublishLimits,
  ZipLimitError,
  type ExtractionLimits,
  type PublishLimits,
} from "./limits.ts";
export { publishStoredZip, PUBLISH_SCRATCH_ID, type PublishZipOptions } from "./run.ts";

export { ZipInvalidError } from "./invalid-zip.ts";
export { dropUploadZip, type DropZipDeps, type DropZipResult } from "./drop-zip.ts";
export {
  buildScratchDir,
  removeBuildScratch,
  removeJobScratch,
  SCRATCH_DIRNAME,
  SCRATCH_MAX_AGE_MS,
  sweepOrphanedScratch,
  type ScratchSweepOptions,
} from "./scratch.ts";
export { ContentCollectingError, recordContentUses } from "./content-uses.ts";
export { extractStorybookToScratch, persistStorybookStatics } from "./statics.ts";
