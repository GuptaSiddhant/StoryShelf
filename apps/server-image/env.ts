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

/**
 * A refusal to start because of how the image is configured. Its message names the variable, never
 * its value, and is the whole report: a stack trace would only point at the bundle.
 */
export class BootRefusal extends Error {
  override readonly name = "BootRefusal";
}

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
    throw new BootRefusal("Set only one of DATABASE_CA and DATABASE_CA_FILE");
  }
  return file === undefined ? pem : readCaFile(file, readFile);
}

/** The PEM in `path`; an error says what failed, never the path or the contents. */
function readCaFile(path: string, readFile: (path: string) => string): string {
  let text: string;
  try {
    text = readFile(path);
  } catch {
    throw new BootRefusal("DATABASE_CA_FILE could not be read");
  }
  if (text.trim() === "") {
    throw new BootRefusal("DATABASE_CA_FILE is empty");
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
  throw new BootRefusal("DATABASE_URL must start with postgres://, postgresql:// or mysql://");
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
    throw new BootRefusal("SHELF_STORYBOOK_HOSTING must be trusted (the default) or sandboxed");
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
      throw new BootRefusal("SHELF_AUTH=none and AUTH_PASSWORD are both set: unset one of them");
    }
    return { mode: "none" };
  }
  if (mode !== "password") {
    throw new BootRefusal("SHELF_AUTH must be password (the default) or none");
  }
  return passwordAuth(env, password);
}

/** The password mode's settings: AUTH_PASSWORD and SECRET are both required. */
function passwordAuth(env: Env, password: string | undefined): ImageAuth {
  const secret = nonEmpty(env["SECRET"]);
  if (password === undefined) {
    throw new BootRefusal(`AUTH_PASSWORD is unset: ${AUTH_MODE_HINT}`);
  }
  if (secret === undefined) {
    throw new BootRefusal(`SECRET is unset: ${AUTH_MODE_HINT}`);
  }
  // Checked again by createShelfAuth; refused here too, before any adapter is created.
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new BootRefusal(
      `SECRET is shorter than ${MIN_SECRET_LENGTH} characters: ${AUTH_MODE_HINT}`,
    );
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
 * What a failed start prints. A `BootRefusal` is one line, `storyshelf: <reason>`: the reason names
 * the variable and never its value, so it is safe to show and to grep. Any other error is a real
 * crash: the same first line, then its stack frames, so it is never hidden.
 */
export function describeBootFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return `storyshelf: ${String(error)}\n`;
  }
  if (error instanceof BootRefusal) {
    return `storyshelf: ${error.message}\n`;
  }
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "));
  return [`storyshelf: ${error.message}`, ...frames, ""].join("\n");
}
