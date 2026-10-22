/**
 * Serving a build's published files (ADR 0010, ADR 0007 decision 5): the single place that decodes
 * and checks a request path, reads the file through the build's manifest and sets the headers.
 * The published Storybook routes (`/projects/:slug/storybook/build/:id/*`, `/_/:id/*`) and the
 * signed URL route (`/_s/:token/*`) all end here, each bringing the access {@link publishedAccess}
 * granted.
 */
import { readPublishedFile } from "@storyshelf/core/capture";
import { isSafeSegment, mimeFor } from "@storyshelf/core/utils";
import type { Context } from "hono";
import { getStore } from "../store.ts";
import { publishedCorsHeaders, type PublishedAccess } from "./published-access.ts";

/** Headers of every signed URL answer: a token URL must not be cached, indexed or leaked by `Referer`. */
export const SIGNED_URL_HEADERS = {
  "cache-control": "private, no-store",
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
  /** `Cache-Control` of a normal answer; a signed URL always answers `private, no-store`. */
  cacheControl: string;
}

/** The file as a response, or `null` when the build has no such file. */
export async function servePublishedFile(
  c: Context,
  request: PublishedFileRequest,
): Promise<Response | null> {
  const { projectId, buildId, rel, access } = request;
  const file = await readPublishedFile(getStore().storage, projectId, buildId, rel);
  if (!file) {
    return null;
  }
  const headers =
    access === "token" ? SIGNED_URL_HEADERS : { "cache-control": request.cacheControl };
  return c.body(new Uint8Array(file), 200, {
    ...headers,
    ...publishedCorsHeaders(access),
    "content-type": mimeFor(rel),
  });
}
