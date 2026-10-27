/** An archive that cannot be parsed; retrying the same bytes cannot help. */
export class ZipInvalidError extends Error {
  override readonly name = "ZipInvalidError";
}
