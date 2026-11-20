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
  postgres(url: string, ca?: string, max?: number): DatabaseAdapter;
  rdsIam(options: RdsIamDatabaseOptions): DatabaseAdapter;
  mysql(url: string, ca?: string): DatabaseAdapter;
  s3(options: S3StorageOptions): StorageAdapter;
  local(dataDir: string): StorageAdapter;
}

const DEFAULTS: Factories = {
  sqlite: createSqliteDatabase,
  postgres: (url, ca, max) =>
    createPostgresDatabase({ url, max, ...(ca === undefined ? {} : { ssl: { ca } }) }),
  rdsIam: createRdsIamDatabase,
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

/** A positive whole number from the environment, or undefined when unset; a bad value refuses to boot. */
function positiveIntFromEnv(
  env: Env,
  name: string,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const raw = nonEmpty(env[name]);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(
      `${name} must be a positive whole number${max === Number.MAX_SAFE_INTEGER ? "" : ` up to ${max}`}`,
    );
  }
  return value;
}

/** `DATABASE_POOL_MAX` as a positive whole number, or undefined when unset. */
export function poolMaxFromEnv(env: Env): number | undefined {
  return positiveIntFromEnv(env, "DATABASE_POOL_MAX");
}

/** The variables of an RDS IAM login; any one of them non-empty puts the server in IAM mode. */
const IAM_VARIABLES = [
  "DATABASE_IAM_HOST",
  "DATABASE_IAM_USER",
  "DATABASE_IAM_NAME",
  "DATABASE_IAM_REGION",
  "DATABASE_IAM_PORT",
] as const;

/** The IAM login the environment describes; `region` may come from `AWS_REGION`. */
function rdsIamOptions(env: Env): RdsIamDatabaseOptions {
  const host = nonEmpty(env["DATABASE_IAM_HOST"]);
  const user = nonEmpty(env["DATABASE_IAM_USER"]);
  const database = nonEmpty(env["DATABASE_IAM_NAME"]);
  const region = nonEmpty(env["DATABASE_IAM_REGION"]) ?? nonEmpty(env["AWS_REGION"]);
  const missing = [
    host === undefined ? "DATABASE_IAM_HOST" : undefined,
    user === undefined ? "DATABASE_IAM_USER" : undefined,
    database === undefined ? "DATABASE_IAM_NAME" : undefined,
    region === undefined ? "DATABASE_IAM_REGION (or AWS_REGION)" : undefined,
  ].filter((name) => name !== undefined);
  if (host === undefined || user === undefined || database === undefined || region === undefined) {
    throw new Error(`RDS IAM login is configured but ${missing.join(", ")} is missing`);
  }
  const port = positiveIntFromEnv(env, "DATABASE_IAM_PORT", 65_535);
  // The server certificate is always verified: the bundled RDS roots, or `DATABASE_CA` when set.
  const ca = databaseCaFromEnv(env);
  return {
    host,
    user,
    database,
    region,
    ...(port === undefined ? {} : { port }),
    ...(ca === undefined ? {} : { ca }),
  };
}

/** The RDS IAM database the `DATABASE_IAM_*` variables describe; never combined with `DATABASE_URL`, never a fallback. */
function rdsIamFromEnv(
  env: Env,
  factories: Factories,
): { database: DatabaseAdapter; log: { database: string } } {
  if (nonEmpty(env["DATABASE_URL"]) !== undefined) {
    throw new Error("Set the DATABASE_IAM_* variables or DATABASE_URL, not both");
  }
  const options = rdsIamOptions(env);
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
  const ca = databaseCaFromEnv(env);
  if (/^postgres(ql)?:\/\//u.test(url)) {
    return {
      database: factories.postgres(url, ca, poolMaxFromEnv(env)),
      log: { database: "postgres" },
    };
  }
  if (url.startsWith("mysql://")) {
    return { database: factories.mysql(url, ca), log: { database: "mysql" } };
  }
  // The scheme only: a URL carries the password.
  throw new Error("DATABASE_URL must start with postgres://, postgresql:// or mysql://");
}

/**
 * Which database the environment names. any `DATABASE_IAM_*` variable selects an RDS or Aurora Postgres
 * with short-lived IAM tokens (the `rds-iam` preset); it never falls back to anything else, so an
 * incomplete configuration, or one that also sets `DATABASE_URL`, refuses to boot. Otherwise
 * `DATABASE_URL` names a Postgres or MySQL database, and with neither it is SQLite on the volume.
 */
export function databaseFromEnv(
  env: Env,
  dataDir: string,
  factories: Factories = DEFAULTS,
): { database: DatabaseAdapter; log: { database: string } } {
  if (IAM_VARIABLES.some((name) => nonEmpty(env[name]) !== undefined)) {
    return rdsIamFromEnv(env, factories);
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

/**
 * `SHELF_STORYBOOK_HOSTING`: `trusted` (the default when unset) or `sandboxed` (ADR 0051). Any other
 * value stops boot and never falls back to `trusted`; `subdomain` needs a base domain and DNS, so the
 * image does not offer it yet.
 */
export function storybookHostingFromEnv(env: Env): { mode: "trusted" | "sandboxed" } | undefined {
  const mode = nonEmpty(env["SHELF_STORYBOOK_HOSTING"]);
  if (mode === undefined) {
    return undefined;
  }
  if (mode !== "trusted" && mode !== "sandboxed") {
    throw new Error("SHELF_STORYBOOK_HOSTING must be trusted (the default) or sandboxed");
  }
  return { mode };
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

/** How the image signs people in: the local password admin, or nobody (an explicit `SHELF_AUTH=none`). */
export type ImageAuth =
  | { mode: "password"; password: string; email: string; secret: string }
  | { mode: "none" };

/** The shortest `SECRET` sign-in accepts (the auth engine's own rule). */
const MIN_SECRET_LENGTH = 32;

const AUTH_MODE_HINT =
  "set AUTH_PASSWORD and SECRET (at least 32 characters) to sign in, or SHELF_AUTH=none to run with every route open";

/**
 * Sign-in is on unless `SHELF_AUTH=none` says otherwise: a missing variable never turns it off.
 * `SECRET` must be at least 32 characters; `createShelfAuth` checks it again.
 */
export function authFromEnv(env: Env): ImageAuth {
  const mode = nonEmpty(env["SHELF_AUTH"]) ?? "password";
  const password = nonEmpty(env["AUTH_PASSWORD"]);
  if (mode === "none") {
    if (password !== undefined) {
      throw new Error("SHELF_AUTH=none and AUTH_PASSWORD are both set: unset one of them");
    }
    return { mode: "none" };
  }
  if (mode !== "password") {
    throw new Error("SHELF_AUTH must be password (the default) or none");
  }
  return passwordAuth(env, password);
}

/** The password mode's settings: AUTH_PASSWORD and SECRET are both required. */
function passwordAuth(env: Env, password: string | undefined): ImageAuth {
  const secret = nonEmpty(env["SECRET"]);
  if (password === undefined) {
    throw new Error(`AUTH_PASSWORD is unset: ${AUTH_MODE_HINT}`);
  }
  if (secret === undefined) {
    throw new Error(`SECRET is unset: ${AUTH_MODE_HINT}`);
  }
  // Checked again by createShelfAuth; refused here too, before any adapter is created.
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SECRET is shorter than ${MIN_SECRET_LENGTH} characters: ${AUTH_MODE_HINT}`);
  }
  return {
    mode: "password",
    password,
    email: nonEmpty(env["AUTH_EMAIL"]) ?? "admin@example.com",
    secret,
  };
}

/** Whether a listen address reaches only this machine (so an open server is not exposed). */
export function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}

/**
 * What a failed start prints: `storyshelf: <reason>` as the first line, then the stack. A refusal's
 * reason names the variable and never its value, so the first line is safe to show and to grep.
 */
export function describeBootFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return `storyshelf: ${String(error)}\n`;
  }
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "));
  return [`storyshelf: ${error.message}`, ...frames, ""].join("\n");
}
