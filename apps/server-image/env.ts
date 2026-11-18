/** Choices the product image makes from its environment (adapters, capture, remote browsers). */
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

/** The process environment, or a test's. */
export type Env = Readonly<Record<string, string | undefined>>;

/** An environment value, or undefined when it is unset or empty. */
export function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** The adapter constructors, replaceable so a test can see what they were given. */
export interface Factories {
  sqlite(path: string): DatabaseAdapter;
  postgres(url: string): DatabaseAdapter;
  mysql(url: string): DatabaseAdapter;
  s3(options: S3StorageOptions): StorageAdapter;
  local(dataDir: string): StorageAdapter;
}

const DEFAULTS: Factories = {
  sqlite: createSqliteDatabase,
  postgres: (url) => createPostgresDatabase({ url }),
  mysql: (url) => createMysqlDatabase({ url }),
  s3: createS3Storage,
  local: createLocalStorage,
};

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
  if (/^postgres(ql)?:\/\//u.test(url)) {
    return { database: factories.postgres(url), log: { database: "postgres" } };
  }
  if (url.startsWith("mysql://")) {
    return { database: factories.mysql(url), log: { database: "mysql" } };
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

/** How the image signs people in: the local password admin, or nobody (an explicit `SHELF_AUTH=none`). */
export type ImageAuth =
  | { mode: "password"; password: string; email: string; secret: string }
  | { mode: "none" };

const AUTH_MODE_HINT =
  "set AUTH_PASSWORD and SECRET (at least 32 characters) to sign in, or SHELF_AUTH=none to run with every route open";

/**
 * Sign-in is on unless `SHELF_AUTH=none` says otherwise: a missing variable never turns it off.
 * A set `SECRET` is passed on; `createShelfAuth` refuses one shorter than 32 characters.
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
