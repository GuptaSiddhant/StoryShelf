/** A design link: a project-level file link (`importPath` null) or a component mapping override. */
export interface DesignLink {
  id: string;
  projectId: string;
  /** Story file the URL is mapped to; null for a project-level design file link. */
  importPath: string | null;
  /** Display label of a project-level link. */
  label: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A design provider credential: an admin-set project token (`userId` `""`) or a
 * user's own connection. `tokenEncrypted` holds the access token; OAuth
 * connections also carry an encrypted refresh token and an expiry.
 */
export interface DesignCredential {
  id: string;
  projectId: string;
  /** Provider `metadata.kind`, e.g. `figma`. */
  provider: string;
  /** Owning user id; `""` for the project-wide credential. */
  userId: string;
  /** `token` (pasted personal access token) or `oauth`. */
  authType: string;
  tokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  /** When an OAuth access token expires; null for pasted tokens. */
  expiresAt: string | null;
  /** Last API outcome: `unknown` | `ok` | `unauthorized` | `forbidden`. */
  status: string;
  checkedAt: string | null;
  /** When the credential was set or replaced; drives the rotation clock. */
  createdAt: string;
  updatedAt: string;
}

/** Cached design file/node metadata, keyed by project, provider, viewer, file key and node id. */
export interface DesignNode {
  id: string;
  projectId: string;
  /** Provider `metadata.kind`. */
  provider: string;
  /** Whose access fetched the entry: `""` for the project credential, else a user id. */
  viewerId: string;
  fileKey: string;
  /** Provider node id; empty string for a whole-file link. */
  nodeId: string;
  name: string | null;
  /** File version at fetch time. */
  version: string | null;
  /** File `lastModified` at fetch time. */
  lastModified: string | null;
  /** `ok` | `deleted` | `unauthorized` | `forbidden`. */
  state: string;
  /** Storage path of the cached PNG render (node links only); null when none was fetched. */
  renderPath: string | null;
  /** File `version` the cached render was taken at; a newer file version refetches. */
  renderVersion: string | null;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}
