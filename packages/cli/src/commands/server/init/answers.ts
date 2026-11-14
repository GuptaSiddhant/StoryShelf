/** The answers a `server init` run collects, and the predicates the generators read from them. */

export type DatabaseChoice =
  | "sqlite"
  | "turso"
  | "better-sqlite3"
  | "bun-sqlite"
  | "d1"
  | "postgres"
  | "pg"
  | "neon"
  | "neon-http"
  | "vercel"
  | "pglite"
  | "mysql"
  | "planetscale"
  | "tidb";
export type StorageChoice = "local" | "s3" | "azure" | "gcs";
export type AuthChoice = "none" | "password" | "oauth";
export type GitChoice = "none" | "git";
export type DeployTarget = "local" | "docker" | "aws" | "azure" | "gcp";

export interface Answers {
  name: string;
  dir: string;
  database: DatabaseChoice;
  storage: StorageChoice;
  auth: AuthChoice;
  /** Ignored: git, chat and Figma are built in (ADR 0049). Kept so older answers still type. */
  git?: GitChoice;
  docker: boolean;
  /** SMTP for email notifications and auth mail (installs `nodemailer`). Absent in older mocked answers. */
  notifications?: boolean;
  /** Ignored: Figma is built in (ADR 0049). */
  design?: boolean;
  /** OpenTelemetry wiring (opt-in). Absent means off. */
  observability?: boolean;
  /** Deploy target. Absent in older mocked answers — derived from `docker`. */
  deployTarget?: DeployTarget;
  /** Curated-path opt-in: show the full adapter matrix on local/docker. */
  advancedAdapters?: boolean;
  /** AWS-only follow-ups (asked when deployTarget is `aws`). */
  awsRegion?: string;
  domainName?: string;
  samlMetadataUrl?: string;
  /** Azure-only follow-ups (asked when deployTarget is `azure`). */
  azureLocation?: string;
  entraTenantId?: string;
  /** GCP-only follow-ups (asked when deployTarget is `gcp`). */
  gcpProjectId?: string;
  gcpLocation?: string;
  identityTenant?: string;
}

/** Normalize the deploy target, preserving pre-target answers. */
export function resolveDeployTarget(answers: Answers): DeployTarget {
  return answers.deployTarget ?? (answers.docker ? "docker" : "local");
}

/** Whether the generated server wires an SMTP email transport (opt-in). */
export function wantsNotifications(answers: Answers): boolean {
  return answers.notifications ?? false;
}

/** Whether the generated server wires OpenTelemetry (opt-in). */
export function wantsObservability(answers: Answers): boolean {
  return answers.observability ?? false;
}

/** Whether the Docker setup needs compose: more than one service (Postgres). */
export function needsCompose(answers: Answers): boolean {
  return answers.database === "postgres";
}
