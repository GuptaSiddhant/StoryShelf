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

/** The project's encrypted Figma personal access token and its last observed health. */
export interface DesignToken {
  id: string;
  projectId: string;
  tokenEncrypted: string;
  /** Last API outcome: `unknown` | `ok` | `unauthorized` (expired/revoked) | `forbidden` (no access). */
  status: string;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Cached Figma file/node metadata, keyed by project, file key and node id. */
export interface FigmaNode {
  id: string;
  projectId: string;
  fileKey: string;
  /** API-form node id (`1:2`); empty string for a whole-file link. */
  nodeId: string;
  name: string | null;
  /** Figma file version at fetch time. */
  version: string | null;
  /** File `lastModified` at fetch time. */
  lastModified: string | null;
  /** `ok` | `deleted` | `unauthorized` | `forbidden` | `error`. */
  state: string;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}
