import { ownersOfPeer, type PeerOwner } from "./manifest.ts";

const NOT_FOUND = /Cannot find (?:package|module) '(?<specifier>[^']+)'/u;

/** The package name of an import specifier: `pg/lib/x` is `pg`, `@scope/pkg/x` is `@scope/pkg`. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** `@storyshelf/db/sqlite/turso`, or the bare package when the peer serves all of it. */
function neededBy({ owner, peer }: PeerOwner): string {
  const subpaths = peer.subpaths?.map((subpath) => `${owner}/${subpath.replace(/^\.\//u, "")}`);
  return subpaths === undefined ? owner : subpaths.join(", ");
}

/** The shell line that installs `name` at the range the manifest declares. */
export function installLine(name: string, range: string): string {
  return `npm install ${name}@"${range}"`;
}

/** The bare specifier a failed import could not find, or undefined for any other error. */
function missingSpecifier(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return undefined;
  const specifier = NOT_FOUND.exec((error as Error).message)?.groups?.["specifier"];
  return specifier === undefined || specifier.startsWith(".") || specifier.startsWith("/")
    ? undefined
    : specifier;
}

/**
 * The guided message for a failed import of a known peer: which package or subpath needs it, the
 * range, and the install line, all from the manifest. Undefined for any other error, or a module the
 * manifest does not list as a peer.
 */
export function missingPeerHint(error: unknown): string | undefined {
  const specifier = missingSpecifier(error);
  const name = specifier === undefined ? undefined : packageName(specifier);
  const owners = name === undefined ? [] : ownersOfPeer(name);
  const first = owners[0];
  if (name === undefined || first === undefined) return undefined;
  const needed = owners.map((owner) => neededBy(owner)).join(", ");
  return `The peer dependency ${name} is not installed (needed by ${needed}). Install it: ${installLine(name, first.peer.range)}`;
}
