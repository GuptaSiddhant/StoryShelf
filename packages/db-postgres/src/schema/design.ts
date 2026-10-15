import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./project.ts";

/** Narrow `design_links` table definition. */
export const designLinks = pgTable(
  "design_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    importPath: text("import_path"),
    label: text("label"),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    index("design_links_project_id_idx").on(t.projectId),
    // One mapping per story file; project-level links (null import_path) never collide.
    uniqueIndex("design_links_project_import_path_idx").on(t.projectId, t.importPath),
  ],
);

/**
 * Narrow `design_credentials` table definition: the design-provider credential
 * vault. `user_id` is `''` for the project-wide credential (not NULL, so the
 * unique index holds on every dialect) and a user id for a personal connection.
 */
export const designCredentials = pgTable(
  "design_credentials",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    userId: text("user_id").notNull().default(""),
    authType: text("auth_type").notNull().default("token"),
    tokenEncrypted: text("token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    status: text("status").notNull().default("unknown"),
    checkedAt: timestamp("checked_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    uniqueIndex("design_credentials_project_provider_user_idx").on(
      t.projectId,
      t.provider,
      t.userId,
    ),
  ],
);

/** Narrow `design_nodes` table definition (design metadata + render cache). */
export const designNodes = pgTable(
  "design_nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    viewerId: text("viewer_id").notNull().default(""),
    fileKey: text("file_key").notNull(),
    nodeId: text("node_id").notNull().default(""),
    name: text("name"),
    version: text("version"),
    lastModified: text("last_modified"),
    state: text("state").notNull().default("ok"),
    renderPath: text("render_path"),
    renderVersion: text("render_version"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    uniqueIndex("design_nodes_project_file_node_idx").on(
      t.projectId,
      t.provider,
      t.viewerId,
      t.fileKey,
      t.nodeId,
    ),
  ],
);

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

/** A design provider credential: an admin-set project token (`userId` `""`) or a user's own connection. */
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
  provider: string;
  /** Whose access fetched the entry: `""` for the project credential, else a user id. */
  viewerId: string;
  fileKey: string;
  /** Provider node id; empty string for a whole-file link. */
  nodeId: string;
  name: string | null;
  version: string | null;
  lastModified: string | null;
  /** `ok` | `deleted` | `unauthorized` | `forbidden`. */
  state: string;
  /** Storage path of the cached PNG render (node links only). */
  renderPath: string | null;
  /** File `version` the cached render was taken at. */
  renderVersion: string | null;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}
