/**
 * Serving a build's published files (ADR 0010, ADR 0007 decision 5): the single place that decodes
 * and checks a request path, reads the file through the build's manifest and sets the headers.
 * The published Storybook routes (`/projects/:slug/storybook/build/:id/*`, `/_/:id/*`) and the
 * signed URL route (`/_s/:token/*`) all end here, each bringing the access {@link publishedAccess}
 * granted.
 */
import { readPublishedFileInfo } from "@storyshelf/core/capture";
import { isSafeSegment, mimeFor, type StorybookTokenClaims } from "@storyshelf/core/utils";
import type { Context } from "hono";
import { getStore } from "../store.ts";
import { signedCacheControl, SIGNED_NO_STORE } from "./capture-cache.ts";
import {
  publishedCacheControl,
  publishedCorsHeaders,
  type PublishedAccess,
  type PublishedFreshness,
} from "./published-access.ts";
import { acceptsGzip, publishedGzip } from "./published-compression.ts";

/**
 * Headers of every signed URL answer: a token URL must not be indexed or leaked by `Referer`, and
 * is `no-store` here. Only a successful answer for a capture grant may replace `cache-control`
 * (`signedCacheControl`); an error always sends these as they are.
 */
export const SIGNED_URL_HEADERS = {
  "cache-control": SIGNED_NO_STORE,
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
} as const;

/**
 * The file path after `base`, decoded once. `""` is the root; `null` when the path is not under
 * `base` or could leave the build: empty, `.` or `..` segments, backslashes and NUL are refused.
 */
export function publishedRelativePath(path: string, base: string): string | null {
  if (!path.startsWith(base)) {
    return null;
  }
  let rest: string;
  try {
    rest = decodeURIComponent(path.slice(base.length));
  } catch {
    return null;
  }
  const safe =
    rest === "" ||
    rest
      .split("/")
      .every(
        (segment) =>
          segment !== "" && segment !== "." && !segment.includes("\0") && isSafeSegment(segment),
      );
  return safe ? rest : null;
}

/** Where a file of a build lives and how the request got to it. */
export interface PublishedFileRequest {
  projectId: string;
  buildId: string;
  /** A path accepted by {@link publishedRelativePath}, not the root. */
  rel: string;
  access: PublishedAccess;
  /**
   * How long a normal answer may be kept. The header itself comes from `publishedCacheControl`, so a
   * caller cannot pass its own value. A signed URL ignores it and answers `signedCacheControl`.
   */
  freshness: PublishedFreshness;
  /** The verified claims of a signed URL's token; decides whether its answer may be fresh. */
  grant?: StorybookTokenClaims | undefined;
}

/** The file as a response, or `null` when the build has no such file. */
export async function servePublishedFile(
  c: Context,
  request: PublishedFileRequest,
): Promise<Response | null> {
  const { projectId, buildId, rel, access } = request;
  const { storage, config } = getStore();
  const file = await readPublishedFileInfo(storage, projectId, buildId, rel);
  if (!file) {
    return null;
  }
  const headers =
    access === "token"
      ? {
          ...SIGNED_URL_HEADERS,
          "cache-control": signedCacheControl({
            cacheMaxAgeSeconds: config.captureAssets?.cacheMaxAgeSeconds,
            grant: request.grant,
            immutable: file.contentHash !== undefined,
          }),
        }
      : { "cache-control": publishedCacheControl(access, request.freshness) };
  const mime = mimeFor(rel);
  const compressed =
    config.publishedCompression && acceptsGzip(c.req.header("accept-encoding"))
      ? await publishedGzip(storage, file.contentHash, file.bytes, mime)
      : undefined;
  return c.body(new Uint8Array(compressed ?? file.bytes), 200, {
    ...headers,
    ...publishedCorsHeaders(access),
    "content-type": mime,
    ...(config.publishedCompression ? { vary: "Accept-Encoding" } : {}),
    ...(compressed ? { "content-encoding": "gzip" } : {}),
  });
}
