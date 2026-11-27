/** The one check of the engine's base URL: one that is not an http(s) URL refuses to start sign-in. */

/** The line a missing, unparseable or scheme-less base URL stops the boot with (#1431). */
export const BASE_URL_MESSAGE =
  "Shelf auth requires SHELF_PUBLIC_BASE_URL (the `baseURL` option) to be a full URL starting with http:// or https://, for example SHELF_PUBLIC_BASE_URL=http://localhost:3000";

/**
 * Throw unless `baseURL` parses as an `http:` or `https:` URL.
 *
 * The auth library only checks its base URL on the first request, as an unhandled rejection with a
 * stack, and `localhost:3000/` parses as a URL whose scheme is `localhost:`. Checking here, before the
 * library is built, turns either into one line naming the variable. The value is not echoed.
 */
export function assertBaseUrl(baseURL: unknown): asserts baseURL is string {
  if (typeof baseURL !== "string" || !URL.canParse(baseURL)) {
    throw new Error(BASE_URL_MESSAGE);
  }
  const { protocol } = new URL(baseURL);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(BASE_URL_MESSAGE);
  }
}
