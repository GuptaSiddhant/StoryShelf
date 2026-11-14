/** Guarded `fetch` for project-set URLs: checked address pinned, redirects re-checked. */
import type { LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import {
  assertOutboundUrl,
  MAX_OUTBOUND_REDIRECTS,
  OutboundRefusedError,
  type OutboundResolver,
} from "./outbound.ts";

/** What a guarded request needs; a subset of `RequestInit`. */
export interface GuardedInit {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  signal: AbortSignal;
}

type Transport = (
  target: string,
  init: GuardedInit,
  addresses: LookupAddress[],
) => Promise<Response>;

/** Test seam: replaces the DNS resolver and the pinned transport. Production never sets it. */
const network: { transport: Transport } = {
  transport: async (target, init, addresses) => await pinnedRequest(target, init, addresses),
};

/** Route guarded requests through `transport` ; returns a function that restores. */
export function overrideGuardedNetwork(next: {
  transport: (target: string, init: GuardedInit) => Promise<Response>;
}): () => void {
  const previous = { ...network };
  network.transport = async (target, init): Promise<Response> => await next.transport(target, init);
  return () => {
    network.transport = previous.transport;
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch `url` after the outbound check. Each hop resolves and checks the host, then connects only to
 * a checked address, so a changed DNS answer cannot redirect the connection. A redirect is a new
 * destination, bounded by {@link MAX_OUTBOUND_REDIRECTS}.
 */
export async function guardedFetch(
  url: string,
  init: GuardedInit,
  resolve?: OutboundResolver,
): Promise<Response> {
  let step: Hop = { target: url, init };
  for (let hop = 0; hop <= MAX_OUTBOUND_REDIRECTS; hop += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each hop depends on the previous one
    const result = await visit(step, resolve);
    if ("response" in result) {
      return result.response;
    }
    step = result;
  }
  throw new OutboundRefusedError("too-many-redirects");
}

interface Hop {
  target: string;
  init: GuardedInit;
}

/** Check and send one hop: the final response, or the next hop to follow. */
async function visit(
  { target, init }: Hop,
  resolve: OutboundResolver | undefined,
): Promise<Hop | { response: Response }> {
  const addresses = await assertOutboundUrl(target, resolve);
  const response = await network.transport(target, init, addresses);
  const location = response.headers.get("location");
  if (!REDIRECT_STATUSES.has(response.status) || !location) {
    return { response };
  }
  await discard(response);
  return { target: new URL(location, target).href, init: redirected(init, response.status) };
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing is left to do with a body that will not be read.
  }
}

/** 303 (and 301/302 after a POST) become a bodiless GET, as `fetch` does. */
function redirected(init: GuardedInit, status: number): GuardedInit {
  if (status === 307 || status === 308) {
    return init;
  }
  const { body: _body, headers, ...rest } = init;
  const kept = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-type"),
  );
  return { ...rest, method: "GET", headers: kept };
}

async function pinnedRequest(
  target: string,
  init: GuardedInit,
  addresses: LookupAddress[],
): Promise<Response> {
  const url = new URL(target);
  const transport = url.protocol === "https:" ? https : http;
  return await new Promise<Response>((resolveResponse, reject) => {
    const request = transport.request(
      url,
      {
        method: init.method,
        headers: init.headers,
        signal: init.signal,
        lookup: (_host, options, callback) => {
          const [first] = addresses as [LookupAddress, ...LookupAddress[]];
          if (options.all) {
            (callback as (e: null, a: LookupAddress[]) => void)(null, addresses);
          } else {
            callback(null, first.address, first.family);
          }
        },
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const v of Array.isArray(value) ? value : [value]) {
            if (v !== undefined) {
              headers.append(name, v);
            }
          }
        }
        const status = incoming.statusCode ?? 502;
        const noBody = status === 204 || status === 304 || init.method === "HEAD";
        resolveResponse(
          new Response(noBody ? null : (Readable.toWeb(incoming) as ReadableStream), {
            status,
            headers,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(init.body);
  });
}
