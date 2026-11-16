import type { TrustProxy } from "@storyshelf/core/config";
import type { Context } from "hono";
import { BlockList, isIP } from "node:net";

/**
 * Where a client IP came from: the socket `peer`; a trusted `proxy` header; or, with no
 * `trustProxy` and no socket, an `unverified` forwarded header (the pre-#911 fallback).
 */
export type ClientIpSource = "peer" | "proxy" | "unverified";

/** The client a request is attributed to (rate-limit buckets, client-IP logging). */
export interface ClientIp {
  ip: string;
  source: ClientIpSource;
}

/** Resolve a request's client, or undefined when nothing identifies it. */
export type ClientIpResolver = (c: Pick<Context, "env" | "req">) => ClientIp | undefined;

/**
 * The one client-IP resolver for `ShelfConfig.trustProxy`. Unset keeps the socket peer (and,
 * with no socket, the old unverified header fallback). Set, a forwarded header is read only
 * when the peer is trusted: a hop count trusts that many hops from this server, a list trusts
 * peers inside those IPs/CIDRs, and `"fly"` reads `Fly-Client-IP`. An invalid list throws, so a
 * bad setting stops boot.
 */
export function createClientIpResolver(trust?: TrustProxy): ClientIpResolver {
  if (trust === undefined) {
    return untrustedClient;
  }
  if (trust === "fly") {
    return flyClient;
  }
  if (typeof trust === "number") {
    return (c) => walkForwarded(c, peerIp(c) ?? "", (_address, hop) => hop < trust);
  }
  const trusted = trustedBlockList(trust);
  return (c) => {
    const peer = peerIp(c);
    return peer === undefined ? undefined : walkForwarded(c, peer, (address) => trusted(address));
  };
}

/** Direct peer IP from server runtimes exposing the socket (unspoofable TCP source). */
function peerIp(c: Pick<Context, "env">): string | undefined {
  const env = (c.env ?? {}) as {
    incoming?: { socket?: { remoteAddress?: unknown } };
    server?: { incoming?: { socket?: { remoteAddress?: unknown } } };
  };
  const address =
    env.incoming?.socket?.remoteAddress ?? env.server?.incoming?.socket?.remoteAddress;
  if (typeof address !== "string" || !address) {
    return undefined;
  }
  return normalizeAddress(address) ?? address;
}

/** No proxy is trusted: the peer, else (no socket) the first forwarded entry, unverified. */
function untrustedClient(c: Pick<Context, "env" | "req">): ClientIp | undefined {
  const peer = peerIp(c);
  if (peer) {
    return { ip: peer, source: "peer" };
  }
  const forwarded = [
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim(),
    c.req.header("x-real-ip")?.trim(),
  ].find(Boolean);
  return forwarded ? { ip: forwarded, source: "unverified" } : undefined;
}

/** Fly.io's proxy sets `Fly-Client-IP` on every request it forwards; without it, the peer. */
function flyClient(c: Pick<Context, "env" | "req">): ClientIp | undefined {
  const header = normalizeAddress(c.req.header("fly-client-ip") ?? "");
  if (header) {
    return { ip: header, source: "proxy" };
  }
  const peer = peerIp(c);
  return peer ? { ip: peer, source: "peer" } : undefined;
}

/**
 * Walk `[peer, ...X-Forwarded-For from the right]` while the current hop is trusted; the first
 * untrusted hop is the client. The walk ends at an entry that is not an IP, so a malformed
 * header never names a client.
 */
function walkForwarded(
  c: Pick<Context, "req">,
  peer: string,
  isTrusted: (address: string, hop: number) => boolean,
): ClientIp | undefined {
  const chain = [peer, ...forwardedFromRight(c)];
  let hop = 0;
  while (hop + 1 < chain.length && isTrusted(chain[hop] ?? "", hop)) {
    hop += 1;
  }
  const ip = chain[hop];
  return ip ? { ip, source: hop === 0 ? "peer" : "proxy" } : undefined;
}

/** `X-Forwarded-For` addresses, nearest hop first, up to the first entry that is not an IP. */
function forwardedFromRight(c: Pick<Context, "req">): string[] {
  const entries = (c.req.header("x-forwarded-for") ?? "").split(",").toReversed();
  const addresses: string[] = [];
  for (const entry of entries) {
    const address = normalizeAddress(entry);
    if (address === undefined) {
      break;
    }
    addresses.push(address);
  }
  return addresses;
}

const IPV4_WITH_PORT = /^(?<ip>\d{1,3}(?:\.\d{1,3}){3}):\d+$/u;
const IPV6_WITH_PORT = /^\[(?<ip>[\da-f:.]+)\](?::\d+)?$/iu;
const IPV4_MAPPED = /^::ffff:(?<ip>\d{1,3}(?:\.\d{1,3}){3})$/iu;

/** A bare IP (port and IPv4-mapped prefix stripped), or undefined when `raw` is not one. */
export function normalizeAddress(raw: string): string | undefined {
  const trimmed = raw.trim();
  const unported =
    IPV4_WITH_PORT.exec(trimmed)?.groups?.["ip"] ??
    IPV6_WITH_PORT.exec(trimmed)?.groups?.["ip"] ??
    trimmed;
  const address = IPV4_MAPPED.exec(unported)?.groups?.["ip"] ?? unported;
  return isIP(address) === 0 ? undefined : address;
}

/** A matcher for a `trustProxy` list of IPs and CIDRs; throws on an entry that is neither. */
function trustedBlockList(entries: readonly string[]): (address: string) => boolean {
  const list = new BlockList();
  for (const entry of entries) {
    addTrusted(list, entry);
  }
  return (address) => {
    const family = isIP(address);
    return family !== 0 && list.check(address, family === 6 ? "ipv6" : "ipv4");
  };
}

interface TrustedEntry {
  address: string;
  length: number | undefined;
  type: "ipv4" | "ipv6";
}

function addTrusted(list: BlockList, raw: string): void {
  const { address, length, type } = parseTrustedEntry(raw);
  if (length === undefined) {
    list.addAddress(address, type);
  } else {
    list.addSubnet(address, length, type);
  }
}

/** One `trustProxy` entry as an address, an optional prefix length and a family; throws if invalid. */
function parseTrustedEntry(raw: string): TrustedEntry {
  const [base = "", prefix] = raw.split("/");
  const address = normalizeAddress(base);
  const type = address !== undefined && isIP(address) === 6 ? "ipv6" : "ipv4";
  const length = prefix === undefined ? undefined : Number(prefix);
  const maxLength = type === "ipv6" ? 128 : 32;
  const validLength =
    length === undefined || (Number.isInteger(length) && length >= 0 && length <= maxLength);
  if (address === undefined || !validLength) {
    throw new Error(`Invalid trustProxy entry "${raw}": expected an IP address or CIDR`);
  }
  return { address, length, type };
}
