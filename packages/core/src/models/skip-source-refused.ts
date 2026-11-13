/** Refusal of a skipped build whose source is not, or no longer, eligible (ADR 0044). */

/** A skip was refused because its source is not (or no longer) an eligible one. */
export class SkipSourceRefused extends Error {
  override readonly name = "SkipSourceRefused";
}
