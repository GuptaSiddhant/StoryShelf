/**
 * Serving a build's published files (ADR 0010, ADR 0007 decision 5): the single place that decodes
 * and checks a request path, reads the file through the build's manifest and sets the headers.
 * The published Storybook routes (`/projects/:slug/storybook/build/:id/*`, `/_/:id/*`) and the
 * signed URL route (`/_s/:token/*`) all end here, each bringing the access {@link publishedAccess}
 * granted.
 */
import {
  locatePublishedFile,
  openPublishedFile,
  type OpenedPublishedFile,
} from "@storyshelf/core/capture";
import { isSafeSegment, mimeFor, type StorybookTokenClaims } from "@storyshelf/core/utils";
import type { Context } from "hono";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { getStore } from "../store.ts";
import { signedCacheControl, SIGNED_NO_STORE } from "./capture-cache.ts";
import {
  hostingMode,
  publishedCacheControl,
  publishedCorsHeaders,
  resourcePolicyHeaders,
  sandboxHeaders,
  type PublishedAccess,
  type PublishedFamily,
  type PublishedFreshness,
} from "./published-access.ts";
import { acceptsGzip, isCompressible, publishedGzip } from "./published-compression.ts";

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

/** Set {@link SIGNED_URL_HEADERS} on the response being built: a credential rides in or out of it. */
export function applySignedUrlHeaders(c: Context): void {
  for (const [name, value] of Object.entries(SIGNED_URL_HEADERS)) {
    c.header(name, value);
  }
}

/**
 * The one answer for every refused token request, on `/_s/` and `/_r/` alike, so a caller cannot
 * tell a bad signature from an expired token, a wrong purpose or a missing build.
 */
export function refuseToken(c: Context, reason: string): Response {
  getStore().logger.debug({ reason }, "token storybook request refused");
  return c.text("Not found", 404, SIGNED_URL_HEADERS);
}

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
  /** The route family, which decides the sandbox header (`sandboxHeaders`). */
  family: PublishedFamily;
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
  const { storage, config } = getStore();
  const { projectId, buildId, rel } = request;
  const located = await locatePublishedFile(storage, projectId, buildId, rel);
  const mime = mimeFor(rel);
  const gzipOffered = Boolean(
    config.publishedCompression &&
    located.contentHash !== undefined &&
    isCompressible(mime) &&
    acceptsGzip(c.req.header("accept-encoding")),
  );
  // Bytes are needed to gzip, and to hash a legacy file for its ETag; everything else streams.
  const needsBytes =
    gzipOffered || (located.contentHash === undefined && request.access === "session");
  const file = await openPublishedFile(
    storage,
    projectId,
    buildId,
    rel,
    needsBytes ? "bytes" : "stream",
  );
  return file ? await respondWithFile(c, request, file, gzipOffered) : null;
}

/** The answer for a file that exists: gzip when offered, a `304` when a viewer's copy is current. */
async function respondWithFile(
  c: Context,
  request: PublishedFileRequest,
  file: OpenedPublishedFile,
  gzipOffered: boolean,
): Promise<Response> {
  const { storage, config } = getStore();
  const mime = mimeFor(request.rel);
  const compressed =
    gzipOffered && file.bytes
      ? await publishedGzip(storage, file.contentHash, file.bytes, mime)
      : undefined;
  const validators =
    request.access === "session"
      ? sessionValidator(c, file, compressed !== undefined)
      : { headers: {}, fresh: false };
  const common = {
    ...answerHeaders(request, file.contentHash !== undefined),
    ...validators.headers,
    ...(config.publishedCompression ? { vary: "Accept-Encoding" } : {}),
  };
  if (validators.fresh) {
    file.stream?.destroy();
    return c.body(null, 304, common);
  }
  return respondBody(c, file, compressed, {
    ...common,
    "content-type": mime,
    ...(compressed ? { "content-encoding": "gzip" } : {}),
  });
}

/** A `200` with the gzip copy, the bytes, or the storage stream when nothing needed buffering. */
function respondBody(
  c: Context,
  file: OpenedPublishedFile,
  compressed: Buffer | undefined,
  headers: Record<string, string>,
): Response {
  const bytes = compressed ?? file.bytes;
  if (bytes) {
    return c.body(new Uint8Array(bytes), 200, headers);
  }
  return file.stream
    ? c.body(Readable.toWeb(file.stream) as ReadableStream, 200, headers)
    : c.body(new Uint8Array(), 200, headers);
}

/** `Cache-Control` and CORS of an answer: a signed URL's own rules, or the normal published policy. */
function answerHeaders(
  request: PublishedFileRequest,
  contentAddressed: boolean,
): Record<string, string> {
  const { access, freshness, grant } = request;
  const cacheControl =
    access === "token"
      ? {
          ...SIGNED_URL_HEADERS,
          "cache-control": signedCacheControl({
            cacheMaxAgeSeconds: getStore().config.captureAssets?.cacheMaxAgeSeconds,
            grant,
            immutable: contentAddressed,
          }),
        }
      : { "cache-control": publishedCacheControl(access, freshness) };
  return {
    ...cacheControl,
    ...publishedCorsHeaders(access),
    ...sandboxHeaders(request.family, hostingMode()),
    ...resourcePolicyHeaders(request.family, access),
  };
}

/**
 * The `ETag` of a session answer and whether the request's `If-None-Match` already holds it. The tag
 * is the manifest content hash (the sha-256 of the bytes for a legacy file with none), and a gzip
 * answer is a different representation with its own tag.
 */
function sessionValidator(
  c: Context,
  file: { bytes?: Buffer; contentHash?: string },
  gzip: boolean,
): { headers: { etag: string }; fresh: boolean } {
  const hash =
    file.contentHash ??
    createHash("sha256")
      .update(file.bytes ?? "")
      .digest("hex");
  const etag = `"${hash}${gzip ? "-gzip" : ""}"`;
  const given = c.req.header("if-none-match") ?? "";
  const fresh = given.split(",").some((tag) => tag.trim() === etag || tag.trim() === `W/${etag}`);
  return { headers: { etag }, fresh };
}
