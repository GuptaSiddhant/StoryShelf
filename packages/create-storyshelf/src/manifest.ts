import manifest from "../../../config/version-manifest.json" with { type: "json" };

/** One peer dependency of a published package, from the generated version and peer manifest. */
export interface ManifestPeer {
  range: string;
  optional: boolean;
  subpaths?: string[];
}

interface ManifestPackage {
  version: string;
  peers: Record<string, ManifestPeer>;
}

const PACKAGES = manifest.packages as Record<string, ManifestPackage>;

/** The version `@storyshelf/*` packages are written at: this scaffold's own, exact. */
export function ownVersion(): string {
  return packageOf("create-storyshelf").version;
}

function packageOf(name: string): ManifestPackage {
  const found = PACKAGES[name];
  if (found === undefined) throw new Error(`${name} is not in the version manifest`);
  return found;
}

/** The range `owner` declares for its peer `peer` (`npm run manifest` regenerates the file). */
export function peerRange(owner: string, peer: string): string {
  const found = packageOf(owner).peers[peer];
  if (found === undefined) throw new Error(`${owner} has no peer ${peer} in the version manifest`);
  return found.range;
}
