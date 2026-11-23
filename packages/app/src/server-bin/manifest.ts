import manifest from "../../../../config/version-manifest.json" with { type: "json" };

/** One peer dependency of a published package, from the generated version and peer manifest (#1332). */
export interface ManifestPeer {
  range: string;
  optional: boolean;
  /** The subpaths of the package that need the peer; none means the package as a whole. */
  subpaths?: string[];
}

/** A published package in the manifest. */
export interface ManifestPackage {
  version: string;
  peers: Record<string, ManifestPeer>;
}

const PACKAGES = manifest.packages as Record<string, ManifestPackage>;

/** Where `peer` is declared: the package, its range and the subpaths that need it. */
export interface PeerOwner {
  owner: string;
  peer: ManifestPeer;
}

/** Every published package that declares `peer`, in the manifest's (sorted) order. */
export function ownersOfPeer(peer: string): PeerOwner[] {
  return Object.entries(PACKAGES).flatMap(([owner, pkg]) => {
    const declared = pkg.peers[peer];
    return declared === undefined ? [] : [{ owner, peer: declared }];
  });
}
