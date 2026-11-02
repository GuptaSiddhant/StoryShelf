/**
 * `Cache-Control` of a signed Storybook answer (ADR 0007, decision 5): `private, no-store` unless
 * the server has opted a capture-scoped grant into browser-private freshness. The single owner of
 * that rule; the runner never sets headers, it only receives a URL.
 */
import { MAX_CAPTURE_ASSET_CACHE_SECONDS } from "@storyshelf/core/config";
import type { StorybookTokenClaims } from "@storyshelf/core/utils";

/** Every signed answer's default, and the only value for an error, a preview or a legacy token. */
export const SIGNED_NO_STORE = "private, no-store";

/** What decides the freshness of one successful signed answer. */
export interface SignedCacheInput {
  /** `config.captureAssets.cacheMaxAgeSeconds`; unset or 0 keeps `no-store`. */
  cacheMaxAgeSeconds: number | undefined;
  /** The verified claims of the token that authorized the request. */
  grant: Pick<StorybookTokenClaims, "purpose" | "expiresAt"> | undefined;
  /** Whether the file came through the build's finalized, content-addressed manifest. */
  immutable: boolean;
  /** Clock override for tests (ms). */
  now?: number;
}

/**
 * `private, max-age=N` with N the whole seconds of the smallest of the configured cap, one hour
 * and the grant's remaining verified lifetime at this response; `no-store` when freshness is not
 * opted in, the grant is not a capture grant, the file is not content-addressed, or none is left.
 * It never grants freshness past the token's expiry. It does not affect authorization, which the
 * route re-checks on every network request.
 */
export function signedCacheControl(input: SignedCacheInput): string {
  const { cacheMaxAgeSeconds, grant, immutable } = input;
  if (
    !cacheMaxAgeSeconds ||
    cacheMaxAgeSeconds <= 0 ||
    !immutable ||
    grant?.purpose !== "capture"
  ) {
    return SIGNED_NO_STORE;
  }
  const remaining = grant.expiresAt - (input.now ?? Date.now()) / 1000;
  const seconds = Math.floor(
    Math.min(cacheMaxAgeSeconds, MAX_CAPTURE_ASSET_CACHE_SECONDS, remaining),
  );
  return seconds > 0 ? `private, max-age=${String(seconds)}` : SIGNED_NO_STORE;
}
