import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import {
  baselines as baselinesTable,
  buildLabels as buildLabelsTable,
  builds as buildsTable,
  comments as commentsTable,
  labelTypes as labelTypesTable,
  projectMembers as projectMembersTable,
  projects as projectsTable,
  projectStatusConfigs as projectStatusConfigsTable,
  snapshots as snapshotsTable,
  tokens as tokensTable,
  users as usersTable,
  webhooks as webhooksTable,
} from "./schema-tables.ts";
import type { BuildStatus, ProjectRole, SiteRole, SnapshotStatus } from "./types.ts";

/**
 * Database schema: table handles, row types, and the schema object passed to
 * the Drizzle client.
 */

/** Storybook metadata synced from a project's published Storybook. */
export interface StorybookMeta {
  framework?: { name?: string; options?: unknown };
  addons?: string[];
  storiesGlobs?: string[];
  staticDirs?: string[];
  packagePath?: string;
  previewParameters?: Record<string, unknown>;
}

/** Projects table (one row per Storybook project). */
export const projects: AnySQLiteTable = projectsTable;
/** Project status-configs table (merge-gate configurations). */
export const projectStatusConfigs: AnySQLiteTable = projectStatusConfigsTable;
/** Builds table (one row per uploaded Storybook build). */
export const builds: AnySQLiteTable = buildsTable;
/** Snapshots table (one row per captured story screenshot). */
export const snapshots: AnySQLiteTable = snapshotsTable;
/** Baselines table (accepted reference snapshots per branch). */
export const baselines: AnySQLiteTable = baselinesTable;
/** Comments table (review comments on snapshots). */
export const comments: AnySQLiteTable = commentsTable;
/** Label-types table (project-defined build label vocabularies). */
export const labelTypes: AnySQLiteTable = labelTypesTable;
/** Build-labels table (labels attached to builds). */
export const buildLabels: AnySQLiteTable = buildLabelsTable;
/** Tokens table (CI token hashes per project). */
export const tokens: AnySQLiteTable = tokensTable;
/** Webhooks table (outgoing build-event subscriptions). */
export const webhooks: AnySQLiteTable = webhooksTable;
/** Users table (dashboard members). */
export const users: AnySQLiteTable = usersTable;
/** Project-members table (per-project memberships and roles). */
export const projectMembers: AnySQLiteTable = projectMembersTable;

/** Full Drizzle schema object passed to the database client. */
export const schema = {
  projects,
  projectStatusConfigs,
  builds,
  snapshots,
  baselines,
  comments,
  labelTypes,
  buildLabels,
  tokens,
  webhooks,
  users,
  projectMembers,
};

/** The full database schema type. */
export type Schema = typeof schema;

/** A project row. */
export interface Project {
  id: string;
  name: string;
  slug: string;
  gitRepository: string | null;
  gitDefaultBranch: string;
  pixelThreshold: number;
  maxDiffRatio: number;
  publicBranchRegex: string | null;
  storybookMeta: string | null | undefined;
  executePlay: boolean;
  playTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

/** A project status-config row. */
export interface ProjectStatusConfig {
  id: string;
  projectId: string;
  provider: string;
  config: string;
  tokenEncrypted: string;
  createdAt: string;
  updatedAt: string;
}

/** A build row. */
export interface Build {
  id: string;
  projectId: string;
  gitSha: string;
  gitBranch: string;
  isDefault: boolean;
  authorEmail: string | null;
  authorName: string | null;
  message: string | null;
  public: boolean;
  status: BuildStatus;
  snapshotCount: number;
  changedCount: number;
  approvedCount: number;
  rejectedCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A snapshot row. */
export interface Snapshot {
  id: string;
  projectId: string;
  buildId: string;
  storyId: string;
  storyName: string;
  storyTitle: string;
  storyImportPath: string | null;
  viewportName: string;
  viewportWidth: number;
  viewportHeight: number;
  screenshotPath: string;
  diffPath: string | null;
  diffPixels: number | null;
  diffRatio: number | null;
  diffPassed: boolean | null;
  status: SnapshotStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A baseline row. */
export interface Baseline {
  id: string;
  projectId: string;
  storyId: string;
  viewportName: string;
  branch: string;
  snapshotId: string | null;
  screenshotPath: string;
  createdAt: string;
  updatedAt: string;
}

/** A comment row. */
export interface Comment {
  id: string;
  projectId: string;
  buildId: string;
  snapshotId: string | null;
  userId: string;
  body: string;
  parentId: string | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A label-type row. */
export interface LabelType {
  id: string;
  projectId: string;
  key: string;
  name: string;
  linkTemplate: string | null;
  color: string | null;
  createdAt: string;
}

/** A build-label row. */
export interface BuildLabel {
  id: string;
  projectId: string;
  buildId: string;
  typeKey: string;
  value: string;
  createdAt: string;
}

/** A CI token row (hash only; the secret itself is never stored). */
export interface Token {
  id: string;
  projectId: string;
  name: string;
  hash: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** A webhook subscription row. */
export interface Webhook {
  id: string;
  projectId: string;
  url: string;
  secret: string;
  events: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A user row. */
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: SiteRole;
  lastLoginAt: string | null;
  createdAt: string;
}

/** A project-membership row. */
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
}
