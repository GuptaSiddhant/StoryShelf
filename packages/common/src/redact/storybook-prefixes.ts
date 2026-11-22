/**
 * The path prefixes of the signed Storybook URLs and the shape of their tokens, kept here so
 * `redactSecrets` can scrub a token from any log line without importing the signing code.
 * Core's `storybook-token.ts` re-exports them and stays the owner of signing, verifying and key derivation.
 */

/** The path prefix every signed Storybook URL starts with; `/_/` is the unrelated short link. */
export const STORYBOOK_TOKEN_PREFIX = "/_s/";
/** The path prefix of a read grant (ADR 0051, decision 4): `/_r/<token>/`, never `/_s/`. */
export const STORYBOOK_READ_PREFIX = "/_r/";
/**
 * The path prefix of the exchange on a content host (ADR 0051, decision 5): `/_x/<token>/`. It exists
 * on content hosts only and is never `/_r/` or `/_s/`.
 */
export const STORYBOOK_EXCHANGE_PREFIX = "/_x/";
/** Regex source of a token, shared by the shape check and the log redaction. */
export const STORYBOOK_TOKEN_SOURCE = "[A-Za-z0-9_-]{8,200}\\.[A-Za-z0-9_-]{43}";
