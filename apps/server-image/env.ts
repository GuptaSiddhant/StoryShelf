/** Choices the product image makes from its environment (adapters, capture, remote browsers). */
import type { BrowserName, RemoteBrowser } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { redactUrlForLog } from "@storyshelf/core/utils";
import { createMysqlDatabase } from "@storyshelf/db-mysql";
import { createPostgresDatabase } from "@storyshelf/db-postgres";
import { createRdsIamDatabase, type RdsIamDatabaseOptions } from "@storyshelf/db-postgres/rds-iam";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { azurePlaywright } from "@storyshelf/runner-playwright/remote";
import { createLocalStorage } from "@storyshelf/storage-local";
import { createS3Storage, type S3StorageOptions } from "@storyshelf/storage-s3";

/** The process environment, or a test's. */
export type Env = Readonly<Record<string, string | undefined>>;

/** An environment value, or undefined when it is unset or empty. */
export function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** The adapter constructors, replaceable so a test can see what they were given. */
export interface Factories {
  sqlite(path: string): DatabaseAdapter;
  postgres(url: string, max?: number): DatabaseAdapter;
  rdsIam(options: RdsIamDatabaseOptions): DatabaseAdapter;
  mysql(url: string): DatabaseAdapter;
  s3(options: S3StorageOptions): StorageAdapter;
  local(dataDir: string): StorageAdapter;
}

const DEFAULTS: Factories = {
  sqlite: createSqliteDatabase,
  postgres: (url, max) => createPostgresDatabase({ url, max }),
  rdsIam: createRdsIamDatabase,
  mysql: (url) => createMysqlDatabase({ url }),
  s3: createS3Storage,
  local: createLocalStorage,
};

/** `DATABASE_POOL_MAX` as a positive whole number, or undefined when unset; a bad value refuses to boot. */
export function poolMaxFromEnv(env: Env): number | undefined {
  const raw = nonEmpty(env["DATABASE_POOL_MAX"]);
  if (raw === undefined) {
    return undefined;
  }
  const max = Number(raw);
  if (!Number.isInteger(max) || max < 1) {
    throw new Error("DATABASE_POOL_MAX must be a positive whole number");
  }
  return max;
}

/** The variables an RDS IAM login needs besides `DATABASE_IAM_HOST`; `region` may come from `AWS_REGION`. */
function rdsIamOptions(env: Env, host: string): RdsIamDatabaseOptions {
  const user = nonEmpty(env["DATABASE_IAM_USER"]);
  const database = nonEmpty(env["DATABASE_IAM_NAME"]);
  const region = nonEmpty(env["DATABASE_IAM_REGION"]) ?? nonEmpty(env["AWS_REGION"]);
  const missing = [
    user === undefined ? "DATABASE_IAM_USER" : undefined,
    database === undefined ? "DATABASE_IAM_NAME" : undefined,
    region === undefined ? "DATABASE_IAM_REGION (or AWS_REGION)" : undefined,
  ].filter((name) => name !== undefined);
  if (user === undefined || database === undefined || region === undefined) {
    throw new Error(`DATABASE_IAM_HOST is set but ${missing.join(", ")} is missing`);
  }
  const port = nonEmpty(env["DATABASE_IAM_PORT"]);
  return { host, user, database, region, ...(port === undefined ? {} : { port: Number(port) }) };
}

/** The RDS IAM database `DATABASE_IAM_HOST` names; never combined with `DATABASE_URL`, never a fallback. */
function rdsIamFromEnv(
  env: Env,
  host: string,
  factories: Factories,
): { database: DatabaseAdapter; log: { database: string } } {
  if (nonEmpty(env["DATABASE_URL"]) !== undefined) {
    throw new Error("Set DATABASE_IAM_HOST or DATABASE_URL, not both");
  }
  const options = rdsIamOptions(env, host);
  const max = poolMaxFromEnv(env);
  return {
    database: factories.rdsIam(max === undefined ? options : { ...options, max }),
    log: { database: "postgres-rds-iam" },
  };
}

/** The database a `DATABASE_URL` names, by scheme. Only the scheme is ever reported: a URL carries the password. */
function urlDatabase(
  env: Env,
  url: string,
  factories: Factories,
): { database: DatabaseAdapter; log: { database: string } } {
  if (/^postgres(ql)?:\/\//u.test(url)) {
    const max = poolMaxFromEnv(env);
    return { database: factories.postgres(url, max), log: { database: "postgres" } };
  }
  if (url.startsWith("mysql://")) {
    return { database: factories.mysql(url), log: { database: "mysql" } };
  }
  throw new Error("DATABASE_URL must start with postgres://, postgresql:// or mysql://");
}

/**
 * Which database the environment names. `DATABASE_IAM_HOST` selects an RDS or Aurora Postgres
 * with short-lived IAM tokens (the `rds-iam` preset); it never falls back to anything else, so an
 * incomplete configuration, or one that also sets `DATABASE_URL`, refuses to boot. Otherwise
 * `DATABASE_URL` names a Postgres or MySQL database, and with neither it is SQLite on the volume.
 */
export function databaseFromEnv(
  env: Env,
  dataDir: string,
  factories: Factories = DEFAULTS,
): { database: DatabaseAdapter; log: { database: string } } {
  const host = nonEmpty(env["DATABASE_IAM_HOST"]);
  if (host !== undefined) {
    return rdsIamFromEnv(env, host, factories);
  }
  const url = nonEmpty(env["DATABASE_URL"]);
  if (url === undefined) {
    return { database: factories.sqlite(`${dataDir}/shelf.db`), log: { database: "sqlite" } };
  }
  return urlDatabase(env, url, factories);
}

/** S3-compatible storage when `AWS_BUCKET` is set, else the data volume. Credentials come from the SDK chain. */
export function storageFromEnv(
  env: Env,
  dataDir: string,
  factories: Factories = DEFAULTS,
): { storage: StorageAdapter; log: { storage: "local" | "s3"; endpointOrigin?: string | null } } {
  const bucket = nonEmpty(env["AWS_BUCKET"]);
  if (bucket === undefined) {
    return { storage: factories.local(dataDir), log: { storage: "local" } };
  }
  const endpoint = nonEmpty(env["AWS_ENDPOINT_URL_S3"]);
  return {
    storage: factories.s3({ bucket, endpoint, region: nonEmpty(env["AWS_REGION"]) ?? "auto" }),
    log: { storage: "s3", endpointOrigin: endpoint ? redactUrlForLog(endpoint) : null },
  };
}

/** Capture is on unless `SHELF_CAPTURE=off` (the `-hosting` image sets it: it has no browser). */
export function captureEnabled(env: Env): boolean {
  return nonEmpty(env["SHELF_CAPTURE"]) !== "off";
}

/** The runner's `browsers`: the bundled Chromium, plus `chromium@azure` when a workspace is configured. */
export function browsersFromEnv(env: Env): (BrowserName | RemoteBrowser)[] {
  const endpoint = nonEmpty(env["PLAYWRIGHT_SERVICE_URL"]);
  const token = nonEmpty(env["PLAYWRIGHT_SERVICE_ACCESS_TOKEN"]);
  if (endpoint === undefined || token === undefined) {
    return ["chromium"];
  }
  return ["chromium", azurePlaywright({ endpoint, token, engines: ["chromium"] })];
}
