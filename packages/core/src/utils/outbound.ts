import type { LookupAddress } from "node:dns";
/**
 * Outbound guard for URLs a project configured (webhooks, chat, GitLab hosts).
 *
 * `https` only; the host is resolved and refused when any address is loopback, private, link-local,
 * unique-local, CGNAT, multicast or unspecified. The request connects to an address that was
 * checked ({@link pinnedLookup}), so DNS cannot change between check and connect. The operator
 * allowlist names exact hosts that may be private or plain `http`. A refusal carries a reason code
 * and never the resolved address.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { UserFacingError } from "./user-facing-error.ts";

/** Why a project-set URL was refused. */
export type OutboundReason =
  | "invalid-url"
  | "scheme-not-https"
  | "credentials-in-url"
  | "address-not-public"
  | "unresolvable"
  | "too-many-redirects";

/** Operator policy for project-set URLs (`config.outbound`). */
export interface OutboundPolicy {
  /** Exact hostnames that may be private addresses or plain `http`. No wildcards. */
  allowHosts?: readonly string[];
  /** Permit plain `http` for every host. Development only. */
  allowHttp?: boolean;
}

/** Thrown when a project-set URL fails the guard. The message holds no address. */
export class OutboundRefusedError extends UserFacingError {
  readonly reason: OutboundReason;

  constructor(reason: OutboundReason) {
    super(`Outbound URL refused: ${MESSAGES[reason]}`);
    this.name = "OutboundRefusedError";
    this.reason = reason;
  }
}

const MESSAGES: Record<OutboundReason, string> = {
  "invalid-url": "not a valid URL",
  "scheme-not-https": "must use https",
  "credentials-in-url": "must not contain a username or password",
  "address-not-public": "points at a private or local address",
  unresolvable: "the host does not resolve",
  "too-many-redirects": "too many redirects",
};

/** Redirect hops followed for a guarded request. */
export const MAX_OUTBOUND_REDIRECTS = 3;

let policy: OutboundPolicy = {};

/** Set the process-wide policy (`createShelfApp` calls it with `config.outbound`). */
export function configureOutbound(next?: OutboundPolicy): void {
  policy = { allowHosts: next?.allowHosts?.map(normalizeHost), allowHttp: next?.allowHttp };
}

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replaceAll(/^\[|\]$/gu, "");
}

function isAllowedHost(hostname: string): boolean {
  return policy.allowHosts?.includes(normalizeHost(hostname)) ?? false;
}

/** Resolver seam for tests. */
export type OutboundResolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: OutboundResolver = async (hostname) =>
  await dnsLookup(hostname, { all: true, order: "verbatim" });

let defaultResolver: OutboundResolver = systemResolver;

/** Test seam: the resolver every check uses when none is passed. Returns the restore function. */
export function overrideOutboundResolver(next: OutboundResolver): () => void {
  const previous = defaultResolver;
  defaultResolver = next;
  return () => {
    defaultResolver = previous;
  };
}

const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64 reaches IPv4
  ["2002::", 16], // 6to4 embeds IPv4
  ["fc00::", 7], // unique-local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

/**
 * Whether a literal address is one a project URL may not reach. `BlockList` treats an IPv4-mapped
 * IPv6 address as its IPv4 address. Anything that is not a literal address is blocked.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return true;
  }
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Parse and apply the scheme rules; returns the URL. */
function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundRefusedError("invalid-url");
  }
  const httpOk = policy.allowHttp === true || isAllowedHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && httpOk)) {
    throw new OutboundRefusedError("scheme-not-https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new OutboundRefusedError("credentials-in-url");
  }
  return url;
}

function bareHost(url: URL): string {
  return url.hostname.replaceAll(/^\[|\]$/gu, "");
}

async function addressesOf(hostname: string, resolve: OutboundResolver): Promise<LookupAddress[]> {
  const family = isIP(hostname);
  if (family !== 0) {
    return [{ address: hostname, family }];
  }
  try {
    return await resolve(hostname);
  } catch {
    throw new OutboundRefusedError("unresolvable");
  }
}

/**
 * Resolve the host of a project-set URL and refuse it when any address is not public.
 *
 * @returns The checked addresses to connect to, in resolver order.
 * @throws {OutboundRefusedError} With a reason code and no address in the message.
 */
export async function assertOutboundUrl(
  raw: string,
  resolve: OutboundResolver = defaultResolver,
): Promise<LookupAddress[]> {
  const hostname = bareHost(parseUrl(raw));
  const addresses = await addressesOf(hostname, resolve);
  if (addresses.length === 0) {
    throw new OutboundRefusedError("unresolvable");
  }
  if (!isAllowedHost(hostname) && addresses.some((a) => isBlockedAddress(a.address))) {
    throw new OutboundRefusedError("address-not-public");
  }
  return addresses;
}

/** Non-throwing {@link assertOutboundUrl}: the reason code, or null when the URL is acceptable. */
export async function checkOutboundUrl(
  raw: string,
  resolve: OutboundResolver = defaultResolver,
): Promise<OutboundReason | null> {
  try {
    await assertOutboundUrl(raw, resolve);
    return null;
  } catch (error) {
    if (error instanceof OutboundRefusedError) {
      return error.reason;
    }
    throw error;
  }
}

/** User-facing text for a refusal reason, safe to show in a form. */
export function outboundReasonText(reason: OutboundReason): string {
  return `URL refused: ${MESSAGES[reason]}`;
}
