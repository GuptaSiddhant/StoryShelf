/** `Accept-Encoding` negotiation for the encodings the published-file variants exist in. */

/** A content coding a derived copy of a published file can be stored in. */
export type VariantEncoding = "br" | "gzip";

const PREFERENCE: readonly VariantEncoding[] = ["br", "gzip"];

/**
 * The encodings the client accepts, best first: the higher quality wins and brotli wins a tie. A
 * coding named explicitly beats the wildcard; `q=0` or an invalid quality refuses it.
 */
export function acceptedEncodings(header?: string): VariantEncoding[] {
  if (!header) return [];
  const entries = header.split(",").map((part) => part.trim().split(";"));
  return PREFERENCE.map((name) => ({ name, quality: qualityOf(entries, name) }))
    .filter((candidate) => candidate.quality > 0)
    .toSorted((a, b) => b.quality - a.quality)
    .map((candidate) => candidate.name);
}

/** Gzip is chosen only if explicitly accepted, or by a nonzero wildcard. */
export function acceptsGzip(header?: string): boolean {
  return acceptedEncodings(header).includes("gzip");
}

function qualityOf(entries: string[][], name: VariantEncoding): number {
  const entry =
    entries.find(([coding]) => coding?.trim().toLowerCase() === name) ??
    entries.find(([coding]) => coding?.trim() === "*");
  if (!entry) return 0;
  const quality = entry.slice(1).find((part) => /^\s*q\s*=/iu.test(part));
  if (quality === undefined) return 1;
  const value = Number(quality.split("=")[1]);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0;
}
