/** The one secret check for shelf auth: a missing or short `secret` refuses to start sign-in. */

/** Shortest accepted secret (32 characters ≈ 128+ bits for generated values). */
export const MIN_AUTH_SECRET_LENGTH = 32;

/**
 * Throw unless `secret` is a string of at least {@link MIN_AUTH_SECRET_LENGTH} characters.
 *
 * The auth library only warns on a short secret and falls back to a built-in default when there is
 * none, which would make every session cookie forgeable. The message names the variable and never
 * includes the value.
 */
export function assertAuthSecret(secret: unknown): asserts secret is string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(
      `Shelf auth requires SECRET (the \`secret\` option), which is unset: set it to at least ${MIN_AUTH_SECRET_LENGTH} random characters (for example \`openssl rand -hex 32\`)`,
    );
  }
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(
      `Shelf auth requires SECRET (the \`secret\` option) of at least ${MIN_AUTH_SECRET_LENGTH} characters (for example \`openssl rand -hex 32\`)`,
    );
  }
}
