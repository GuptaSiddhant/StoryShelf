import type { Table } from "drizzle-orm";

/** Type-safe table map enforced on every DatabaseAdapter. */
export interface Tables {
  projects: Table;
  projectStatusConfigs: Table;
  builds: Table;
  captureAttempts: Table;
  captureLogs: Table;
  snapshots: Table;
  baselines: Table;
  comments: Table;
  labelTypes: Table;
  buildLabels: Table;
  tokens: Table;
  webhooks: Table;
  users: Table;
  projectMembers: Table;
  projectGroupMappings: Table;
  contentRefs: Table;
}
