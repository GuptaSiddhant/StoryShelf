/**
 * Gzip/deflate for app HTML pages and `/api/v1` JSON answers (#868), over Hono's `compress`.
 *
 * Only `text/html` and `application/json` are touched, and only answers of at least
 * `MIN_COMPRESS_BYTES`. Everything with its own handling stays byte-for-byte as served: published
 * files and short links (`/_/`), signed Storybook and read-grant routes (`/_s/`, `/_r/`, `/_x/`),
 * assets, and anything that already carries a `Content-Encoding`.
 *
 * BREACH: a page that holds a secret next to attacker-influenced text can leak it through its
 * compressed size. Answers that carry credentials are never compressed: sign-in and auth routes,
 * token and credential routes, and any answer that sets a cookie. The CSRF token in other pages is
 * freshly minted per response (timestamp + signature), so it is not a stable secret to guess.
 */
import type { MiddlewareHandler } from "hono";
import { compress } from "hono/compress";

/** Smaller answers are sent as they are: the gzip header and CPU cost more than they save. */
export const MIN_COMPRESS_BYTES = 1024;

/** Route families that are never compressed (own gzip, signed grants, secrets). */
const SKIPPED =
  /^\/(?:_\/|_s\/|_r\/|_x\/|assets\/|auth\/|api\/auth\/|api\/v1\/tokens|admin\/credentials)/u;

const COMPRESSIBLE = /^(?:text\/html|application\/json)(?:\s*;|$)/iu;

const inner = compress({
  threshold: MIN_COMPRESS_BYTES,
  contentTypeFilter: (type) => COMPRESSIBLE.test(type),
});

/** Create the compression middleware; mount it early so it wraps every later answer. */
export function compression(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (SKIPPED.test(c.req.path) || c.res.headers.has("Set-Cookie")) return;
    if (!COMPRESSIBLE.test(c.res.headers.get("Content-Type") ?? "")) return;
    await withLength(c);
    // The answer is already made: Hono's compress now only has to encode `c.res`.
    await inner(c, async () => {});
  };
}

/** Give a bodied answer an exact `Content-Length`, so the size threshold applies to it. */
async function withLength(c: Parameters<MiddlewareHandler>[0]): Promise<void> {
  const res = c.res;
  if (res.headers.has("Content-Length") || !res.body) return;
  const bytes = await res.arrayBuffer();
  const headers = new Headers(res.headers);
  headers.set("Content-Length", String(bytes.byteLength));
  c.res = new Response(bytes, { status: res.status, statusText: res.statusText, headers });
}
