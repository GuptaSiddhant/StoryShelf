import type { BrowserName, RemoteBrowser } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { redactUrlForLog } from "@storyshelf/core/utils";
import { createMysqlDatabase } from "@storyshelf/db-mysql";
import { createPostgresDatabase } from "@storyshelf/db-postgres";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { azurePlaywright } from "@storyshelf/runner-playwright/remote";
import { createLocalStorage } from "@storyshelf/storage-local";
import { createS3Storage, type S3StorageOptions } from "@storyshelf/storage-s3";
/** Choices the product image makes from its environment (adapters, capture, remote browsers). */
import { readFileSync } from "node:fs";

/** The process environment, or a test's. */
export type Env = Readonly<Record<string, string | undefined>>;

/** An environment value, or undefined when it is unset or empty. */
export function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** The adapter constructors, replaceable so a test can see what they were given. */
export interface Factories {
  sqlite(path: string): DatabaseAdapter;
  postgres(url: string, ca?: string): DatabaseAdapter;
  mysql(url: string, ca?: string): DatabaseAdapter;
  s3(options: S3StorageOptions): StorageAdapter;
  local(dataDir: string): StorageAdapter;
}

const DEFAULTS: Factories = {
  sqlite: createSqliteDatabase,
  postgres: (url, ca) =>
    createPostgresDatabase({ url, ...(ca === undefined ? {} : { ssl: { ca } }) }),
  mysql: (url, ca) => createMysqlDatabase({ url, ...(ca === undefined ? {} : { ssl: { ca } }) }),
  s3: createS3Storage,
  local: createLocalStorage,
};

/**
 * The CA that signs the database's certificate: `DATABASE_CA` (PEM text) or `DATABASE_CA_FILE` (a path).
 * Both set is refused. Errors name the variable, never the contents or the URL.
 */
export function databaseCaFromEnv(
  env: Env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  const pem = nonEmpty(env["DATABASE_CA"]);
  const file = nonEmpty(env["DATABASE_CA_FILE"]);
  if (pem !== undefined && file !== undefined) {
    throw new Error("Set only one of DATABASE_CA and DATABASE_CA_FILE");
  }
  return file === undefined ? pem : readCaFile(file, readFile);
}

/** The PEM in `path`; an error says what failed, never the path or the contents. */
function readCaFile(path: string, readFile: (path: string) => string): string {
  let text: string;
  try {
    text = readFile(path);
  } catch {
    throw new Error("DATABASE_CA_FILE could not be read");
  }
  if (text.trim() === "") {
    throw new Error("DATABASE_CA_FILE is empty");
  }
  return text;
}

/** True when a Postgres URL asks for TLS without verifying the certificate (`require`, `prefer`, `allow`) and no CA is set. */
export function unverifiedDatabaseTls(env: Env): boolean {
  const url = nonEmpty(env["DATABASE_URL"]);
  if (url === undefined || !/^postgres(ql)?:\/\//u.test(url)) {
    return false;
  }
  const unverified = /[?&]sslmode=(?:require|prefer|allow)(?:&|#|$)/u.test(url);
  return unverified && databaseCaFromEnv(env, () => "x") === undefined;
}

/** Which database `DATABASE_URL` names: a Postgres or MySQL URL, else SQLite on the data volume. */
export function databaseFromEnv(
  env: Env,
  dataDir: string,
  factories: Factories = DEFAULTS,
): { database: DatabaseAdapter; log: { database: string } } {
  const url = nonEmpty(env["DATABASE_URL"]);
  if (url === undefined) {
    return { database: factories.sqlite(`${dataDir}/shelf.db`), log: { database: "sqlite" } };
  }
  const ca = databaseCaFromEnv(env);
  if (/^postgres(ql)?:\/\//u.test(url)) {
    return { database: factories.postgres(url, ca), log: { database: "postgres" } };
  }
  if (url.startsWith("mysql://")) {
    return { database: factories.mysql(url, ca), log: { database: "mysql" } };
  }
  // The scheme only: a URL carries the password.
  throw new Error("DATABASE_URL must start with postgres://, postgresql:// or mysql://");
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
