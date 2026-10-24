import { index, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { datetime } from "./datetime.ts";
import { projects } from "./project.ts";

/** Narrow `design_links` table definition. */
export const designLinks = mysqlTable(
  "design_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    importPath: text("import_path"),
    label: text("label"),
    url: text("url").notNull(),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [
    index("design_links_project_id_idx").on(t.projectId),
    // One mapping per story file; project-level links (null import_path) never collide.
    uniqueIndex("design_links_project_import_path_idx").on(t.projectId, t.importPath),
  ],
);

/** Narrow `design_credentials` table definition: the project-wide design-provider token. */
export const designCredentials = mysqlTable(
  "design_credentials",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    status: text("status").notNull().default("unknown"),
    checkedAt: datetime("checked_at", { mode: "string", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [uniqueIndex("design_credentials_project_provider_idx").on(t.projectId, t.provider)],
);

/** Narrow `design_nodes` table definition (design metadata + render cache). */
export const designNodes = mysqlTable(
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
    fetchedAt: datetime("fetched_at", { mode: "string", fsp: 3 }).notNull(),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
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

/** The project-wide token of a design provider (an admin pastes it; encrypted at rest). */
export interface DesignCredential {
  id: string;
  projectId: string;
  /** Provider `metadata.kind`, e.g. `figma`. */
  provider: string;
  tokenEncrypted: string;
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
