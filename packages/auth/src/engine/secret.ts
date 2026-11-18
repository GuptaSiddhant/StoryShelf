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

/**
 * Throw when `BETTER_AUTH_SECRETS` is set: the auth library would sign with its first entry and
 * ignore `secret`, so the checked SECRET would not be the key in use. Rotation goes through
 * `SECRET_PREVIOUS`, never the library's variable.
 */
export function assertNoLibrarySecretOverride(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env["BETTER_AUTH_SECRETS"] !== undefined && env["BETTER_AUTH_SECRETS"] !== "") {
    throw new Error(
      "BETTER_AUTH_SECRETS is set, so the auth library would sign with it instead of SECRET: unset it",
    );
  }
}
