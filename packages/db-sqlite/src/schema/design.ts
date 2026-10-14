import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "./project.ts";

/** Narrow `design_links` table definition. */
export const designLinks = sqliteTable(
  "design_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    importPath: text("import_path"),
    label: text("label"),
    url: text("url").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("design_links_project_id_idx").on(t.projectId),
    // One mapping per story file; project-level links (null import_path) never collide.
    uniqueIndex("design_links_project_import_path_idx").on(t.projectId, t.importPath),
  ],
);

/** Narrow `design_tokens` table definition: the per-project Figma personal access token vault (not design-system tokens). */
export const designTokens = sqliteTable(
  "design_tokens",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tokenEncrypted: text("token_encrypted").notNull(),
    status: text("status").notNull().default("unknown"),
    checkedAt: text("checked_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("design_tokens_project_id_idx").on(t.projectId)],
);

/** Narrow `figma_nodes` table definition (Figma metadata cache). */
export const figmaNodes = sqliteTable(
  "figma_nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fileKey: text("file_key").notNull(),
    nodeId: text("node_id").notNull().default(""),
    name: text("name"),
    version: text("version"),
    lastModified: text("last_modified"),
    state: text("state").notNull().default("ok"),
    renderPath: text("render_path"),
    renderVersion: text("render_version"),
    fetchedAt: text("fetched_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("figma_nodes_project_file_node_idx").on(t.projectId, t.fileKey, t.nodeId)],
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
