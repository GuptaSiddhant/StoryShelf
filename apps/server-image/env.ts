import {
  TARGET_NAME_PATTERN,
  isBrowserName,
  type BrowserName,
} from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { readS3Bucket, readSetting, type SettingName } from "@storyshelf/core/config";
import { createLocalStorage } from "@storyshelf/core/storage/local";
import { redactUrlForLog } from "@storyshelf/core/utils";
import { createMysqlDatabase } from "@storyshelf/db/mysql";
import { createPostgresDatabase } from "@storyshelf/db/postgres";
import { createRdsIamDatabase, type RdsIamDatabaseOptions } from "@storyshelf/db/postgres/rds-iam";
import { createSqliteDatabase } from "@storyshelf/db/sqlite";
import {
  azurePlaywright,
  hasSchemeFor,
  remote,
  type RemoteBrowser,
  type RemoteProtocol,
} from "@storyshelf/runner/remote";
import { createAzureStorage, type AzureStorageOptions } from "@storyshelf/storage/azure";
import { createGcsStorage, type GcsStorageOptions } from "@storyshelf/storage/gcs";
import { createS3Storage, type S3StorageOptions } from "@storyshelf/storage/s3";
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
  postgres(url: string, ca?: string, max?: number): DatabaseAdapter;
  rdsIam(options: RdsIamDatabaseOptions): DatabaseAdapter;
  mysql(url: string, ca?: string): DatabaseAdapter;
  s3(options: S3StorageOptions): StorageAdapter;
  gcs(options: GcsStorageOptions): StorageAdapter;
  azure(options: AzureStorageOptions): StorageAdapter;
  local(dataDir: string): StorageAdapter;
}

const DEFAULTS: Factories = {
  sqlite: createSqliteDatabase,
  postgres: (url, ca, max) =>
    createPostgresDatabase({ url, max, ...(ca === undefined ? {} : { ssl: { ca } }) }),
  rdsIam: createRdsIamDatabase,
  mysql: (url, ca) => createMysqlDatabase({ url, ...(ca === undefined ? {} : { ssl: { ca } }) }),
  s3: createS3Storage,
  gcs: createGcsStorage,
  azure: createAzureStorage,
  local: createLocalStorage,
};

/**
 * The CA that signs the database's certificate: `SHELF_DATABASE_CA` (PEM text) or `SHELF_DATABASE_CA_FILE` (a path).
 * Both set is refused. Errors name the variable, never the contents or the URL.
 */
export function databaseCaFromEnv(
  env: Env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  const pem = nonEmpty(readSetting(env, "SHELF_DATABASE_CA"));
  const file = nonEmpty(readSetting(env, "SHELF_DATABASE_CA_FILE"));
  if (pem !== undefined && file !== undefined) {
    throw new BootRefusal("Set only one of SHELF_DATABASE_CA and SHELF_DATABASE_CA_FILE");
  }
  return file === undefined ? pem : readCaFile(file, readFile);
}

/** The PEM in `path`; an error says what failed, never the path or the contents. */
function readCaFile(path: string, readFile: (path: string) => string): string {
  let text: string;
  try {
    text = readFile(path);
  } catch {
    throw new BootRefusal("SHELF_DATABASE_CA_FILE could not be read");
  }
  if (text.trim() === "") {
    throw new BootRefusal("SHELF_DATABASE_CA_FILE is empty");
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
  name: SettingName,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const raw = nonEmpty(readSetting(env, name));
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

/** `SHELF_DATABASE_POOL_MAX` as a positive whole number, or undefined when unset. */
export function poolMaxFromEnv(env: Env): number | undefined {
  return positiveIntFromEnv(env, "SHELF_DATABASE_POOL_MAX");
}

/** The variables of an RDS IAM login; any one of them non-empty puts the server in IAM mode. */
const IAM_VARIABLES = [
  "SHELF_DATABASE_IAM_HOST",
  "SHELF_DATABASE_IAM_USER",
  "SHELF_DATABASE_IAM_NAME",
  "SHELF_DATABASE_IAM_REGION",
  "SHELF_DATABASE_IAM_PORT",
] as const;

/** The IAM login the environment describes; `region` may come from `AWS_REGION`. */
function rdsIamOptions(env: Env): RdsIamDatabaseOptions {
  const host = nonEmpty(readSetting(env, "SHELF_DATABASE_IAM_HOST"));
  const user = nonEmpty(readSetting(env, "SHELF_DATABASE_IAM_USER"));
  const database = nonEmpty(readSetting(env, "SHELF_DATABASE_IAM_NAME"));
  const region =
    nonEmpty(readSetting(env, "SHELF_DATABASE_IAM_REGION")) ?? nonEmpty(env["AWS_REGION"]);
  const missing = [
    host === undefined ? "SHELF_DATABASE_IAM_HOST" : undefined,
    user === undefined ? "SHELF_DATABASE_IAM_USER" : undefined,
    database === undefined ? "SHELF_DATABASE_IAM_NAME" : undefined,
    region === undefined ? "SHELF_DATABASE_IAM_REGION (or AWS_REGION)" : undefined,
  ].filter((name) => name !== undefined);
  if (host === undefined || user === undefined || database === undefined || region === undefined) {
    throw new Error(`RDS IAM login is configured but ${missing.join(", ")} is missing`);
  }
  const port = positiveIntFromEnv(env, "SHELF_DATABASE_IAM_PORT", 65_535);
  // The server certificate is always verified: the bundled RDS roots, or `SHELF_DATABASE_CA` when set.
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

/** The RDS IAM database the `SHELF_DATABASE_IAM_*` variables describe; never combined with `DATABASE_URL`, never a fallback. */
function rdsIamFromEnv(
  env: Env,
  factories: Factories,
): { database: DatabaseAdapter; log: { database: string } } {
  if (nonEmpty(env["DATABASE_URL"]) !== undefined) {
    throw new Error("Set the SHELF_DATABASE_IAM_* variables or DATABASE_URL, not both");
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
  throw new BootRefusal("DATABASE_URL must start with postgres://, postgresql:// or mysql://");
}

/**
 * Which database the environment names. any `SHELF_DATABASE_IAM_*` variable selects an RDS or Aurora Postgres
 * with short-lived IAM tokens (the `rds-iam` preset); it never falls back to anything else, so an
 * incomplete configuration, or one that also sets `DATABASE_URL`, refuses to boot. Otherwise
 * `DATABASE_URL` names a Postgres or MySQL database, and with neither it is SQLite on the volume.
 */
export function databaseFromEnv(
  env: Env,
  dataDir: string,
  factories: Factories = DEFAULTS,
): { database: DatabaseAdapter; log: { database: string } } {
  if (IAM_VARIABLES.some((name) => nonEmpty(readSetting(env, name)) !== undefined)) {
    return rdsIamFromEnv(env, factories);
  }
  const url = nonEmpty(env["DATABASE_URL"]);
  if (url === undefined) {
    return { database: factories.sqlite(`${dataDir}/shelf.db`), log: { database: "sqlite" } };
  }
  return urlDatabase(env, url, factories);
}

/** Which storage the image chose, and what it may log (never a key, a SAS token or a connection string). */
export interface StorageChoice {
  storage: StorageAdapter;
  log: {
    storage: "local" | "s3" | "gcs" | "azure";
    endpointOrigin?: string | null;
    auth?: "managed-identity" | "connection-string";
  };
}

/** The storage variables, one set per backend; setting more than one backend refuses to boot. */
const STORAGE_SELECTORS = [
  ["SHELF_GCS_BUCKET", "GCS"],
  ["SHELF_AZURE_ACCOUNT", "Azure Blob"],
  ["SHELF_AZURE_CONNECTION_STRING", "Azure Blob"],
] as const;

/** Refuses a second backend: the first match would silently win and hide a misconfiguration. */
function assertOneStorage(env: Env): void {
  const chosen = new Set(
    STORAGE_SELECTORS.filter(([name]) => nonEmpty(readSetting(env, name)) !== undefined).map(
      ([, kind]) => kind as string,
    ),
  );
  if (readS3Bucket(env) !== undefined) {
    chosen.add("S3");
  }
  if (chosen.size > 1) {
    throw new Error(
      "Set one storage backend: SHELF_S3_BUCKET, SHELF_GCS_BUCKET, or SHELF_AZURE_ACCOUNT/SHELF_AZURE_CONNECTION_STRING",
    );
  }
}

/** Azure Blob: a connection string when given (other hosts), else the host's managed identity. */
function azureFromEnv(env: Env, factories: Factories): StorageChoice {
  const container = nonEmpty(readSetting(env, "SHELF_AZURE_CONTAINER"));
  const connectionString = nonEmpty(readSetting(env, "SHELF_AZURE_CONNECTION_STRING"));
  const accountName = nonEmpty(readSetting(env, "SHELF_AZURE_ACCOUNT"));
  if (container === undefined) {
    throw new Error("SHELF_AZURE_CONTAINER is unset: Azure Blob storage needs a container name");
  }
  if (connectionString !== undefined) {
    return {
      storage: factories.azure({ container, connectionString }),
      log: { storage: "azure", auth: "connection-string" },
    };
  }
  const managedIdentityClientId = nonEmpty(env["AZURE_CLIENT_ID"]);
  return {
    storage: factories.azure({
      container,
      accountName,
      ...(managedIdentityClientId === undefined ? {} : { managedIdentityClientId }),
    }),
    log: { storage: "azure", auth: "managed-identity" },
  };
}

/** Google Cloud Storage from `SHELF_GCS_BUCKET`; the project is optional (Application Default Credentials know it). */
function gcsFromEnv(env: Env, bucket: string, factories: Factories): StorageChoice {
  const projectId = nonEmpty(env["GOOGLE_CLOUD_PROJECT"]);
  return {
    storage: factories.gcs({ bucket, ...(projectId === undefined ? {} : { projectId }) }),
    log: { storage: "gcs" },
  };
}

/** S3-compatible storage from `SHELF_S3_BUCKET` (or Fly's `BUCKET_NAME`), else the data volume. */
function s3OrLocalFromEnv(env: Env, dataDir: string, factories: Factories): StorageChoice {
  const bucket = readS3Bucket(env);
  if (bucket === undefined) {
    return { storage: factories.local(dataDir), log: { storage: "local" } };
  }
  const endpoint = nonEmpty(env["AWS_ENDPOINT_URL_S3"]);
  return {
    storage: factories.s3({ bucket, endpoint, region: nonEmpty(env["AWS_REGION"]) ?? "auto" }),
    log: { storage: "s3", endpointOrigin: endpoint ? redactUrlForLog(endpoint) : null },
  };
}

/**
 * The storage the environment names: S3-compatible with `SHELF_S3_BUCKET`, Google Cloud Storage with
 * `SHELF_GCS_BUCKET`, Azure Blob with `SHELF_AZURE_ACCOUNT` (managed identity, `AZURE_CLIENT_ID` picks a
 * user-assigned one) or `SHELF_AZURE_CONNECTION_STRING`, else the data volume. Credentials come from each
 * SDK's own chain; more than one backend refuses to boot.
 */
export function storageFromEnv(
  env: Env,
  dataDir: string,
  factories: Factories = DEFAULTS,
): StorageChoice {
  assertOneStorage(env);
  const gcsBucket = nonEmpty(readSetting(env, "SHELF_GCS_BUCKET"));
  if (gcsBucket !== undefined) {
    return gcsFromEnv(env, gcsBucket, factories);
  }
  if (
    STORAGE_SELECTORS.some(
      ([name, kind]) => kind === "Azure Blob" && nonEmpty(readSetting(env, name)) !== undefined,
    )
  ) {
    return azureFromEnv(env, factories);
  }
  return s3OrLocalFromEnv(env, dataDir, factories);
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

/** The variables that describe the one generic remote browser; any one of them set turns it on. */
const REMOTE_VARIABLES = [
  "SHELF_REMOTE_BROWSER_ENDPOINT",
  "SHELF_REMOTE_BROWSER_TOKEN",
  "SHELF_REMOTE_BROWSER_PROTOCOL",
  "SHELF_REMOTE_BROWSER_REACH",
  "SHELF_REMOTE_BROWSER_NAME",
  "SHELF_REMOTE_BROWSER_ENGINES",
  "SHELF_REMOTE_BROWSER_SESSIONS",
  "SHELF_REMOTE_BROWSER_MAX_CONNECTIONS",
] as const;

/** The target name half of the generic remote browser when `SHELF_REMOTE_BROWSER_NAME` is unset. */
const DEFAULT_REMOTE_NAME = "remote";

/** The name half `azurePlaywright` takes; a generic remote browser never shares it. */
const AZURE_NAME = "azure";

/** A choice declared in the environment (never inferred): one of `allowed`, else a refusal naming the variable. */
function declaredChoice<T extends string>(
  env: Env,
  name: (typeof REMOTE_VARIABLES)[number],
  allowed: readonly T[],
): T {
  const value = nonEmpty(readSetting(env, name));
  if (value === undefined) {
    throw new BootRefusal(`${name} is unset: declare it as ${allowed.join(" or ")}`);
  }
  const chosen = allowed.find((option) => option === value);
  if (chosen === undefined) {
    throw new BootRefusal(`${name} must be ${allowed.join(" or ")}`);
  }
  return chosen;
}

/** An optional positive whole number; any other value refuses, naming the variable and not the value. */
function remoteCount(env: Env, name: (typeof REMOTE_VARIABLES)[number]): number | undefined {
  const raw = nonEmpty(readSetting(env, name));
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(value) || value < 1) {
    throw new BootRefusal(`${name} must be a positive whole number`);
  }
  return value;
}

/** `SHELF_REMOTE_BROWSER_ENGINES`: a comma-separated list of engines, default `chromium`. */
function remoteEngines(env: Env, protocol: RemoteProtocol): BrowserName[] {
  const raw = nonEmpty(readSetting(env, "SHELF_REMOTE_BROWSER_ENGINES")) ?? "chromium";
  const engines: BrowserName[] = [];
  for (const part of raw.split(",").map((engine) => engine.trim())) {
    if (!isBrowserName(part) || engines.includes(part)) {
      throw new BootRefusal(
        "SHELF_REMOTE_BROWSER_ENGINES must list each of chromium, firefox, webkit or chrome at most once, separated by commas",
      );
    }
    engines.push(part);
  }
  if (
    protocol === "cdp" &&
    engines.some((engine) => engine !== "chromium" && engine !== "chrome")
  ) {
    throw new BootRefusal(
      "SHELF_REMOTE_BROWSER_ENGINES: the cdp protocol drives chromium or chrome only",
    );
  }
  return engines;
}

/** The target name half: `SHELF_REMOTE_BROWSER_NAME`, default `remote`; never `azure`, which `azurePlaywright` owns. */
function remoteName(env: Env): string {
  const name = nonEmpty(readSetting(env, "SHELF_REMOTE_BROWSER_NAME")) ?? DEFAULT_REMOTE_NAME;
  if (!TARGET_NAME_PATTERN.test(name)) {
    throw new BootRefusal(
      "SHELF_REMOTE_BROWSER_NAME must be lowercase letters, digits and hyphens, start with a letter or digit and be at most 32 characters",
    );
  }
  if (name === AZURE_NAME && azureConfigured(env)) {
    throw new BootRefusal(
      "SHELF_REMOTE_BROWSER_NAME must not be azure while PLAYWRIGHT_SERVICE_URL and PLAYWRIGHT_SERVICE_ACCESS_TOKEN are set",
    );
  }
  return name;
}

/** A `reach: "url"` target is opened through a signed Storybook URL: it needs a secret to sign it and an origin to put in it. */
function assertUrlReach(env: Env): void {
  if (nonEmpty(readSetting(env, "SHELF_SECRET")) === undefined) {
    throw new BootRefusal(
      "SHELF_REMOTE_BROWSER_REACH=url needs SHELF_SECRET: it signs the Storybook URL the remote browser opens",
    );
  }
  if (nonEmpty(readSetting(env, "SHELF_PUBLIC_BASE_URL")) === undefined) {
    throw new BootRefusal(
      "SHELF_REMOTE_BROWSER_REACH=url needs SHELF_PUBLIC_BASE_URL: the remote browser opens a URL on the confirmed origin",
    );
  }
}

/** The endpoint, which can carry a key: only its scheme is checked, and only the variable is named. */
function remoteEndpoint(env: Env, protocol: RemoteProtocol): string {
  const endpoint = nonEmpty(readSetting(env, "SHELF_REMOTE_BROWSER_ENDPOINT"));
  if (endpoint === undefined) {
    throw new BootRefusal(
      "SHELF_REMOTE_BROWSER_ENDPOINT is unset: it is required with the other SHELF_REMOTE_BROWSER_* variables",
    );
  }
  if (!hasSchemeFor(protocol, endpoint)) {
    throw new BootRefusal(
      `SHELF_REMOTE_BROWSER_ENDPOINT must be a ${protocol === "cdp" ? "ws(s):// or http(s)://" : "ws(s)://"} URL`,
    );
  }
  return endpoint;
}

/**
 * The one generic remote browser the `SHELF_REMOTE_BROWSER_*` variables describe, or undefined when
 * none is set (ADR 0050). `protocol` and `reach` are declared, never inferred. The endpoint and
 * token are secrets (the runner scrubs them from what it surfaces) and a refusal names the
 * variable, never its value: a half-set, unknown or malformed configuration stops boot.
 */
export function remoteBrowserFromEnv(env: Env): RemoteBrowser | undefined {
  if (REMOTE_VARIABLES.every((name) => nonEmpty(readSetting(env, name)) === undefined)) {
    return undefined;
  }
  const protocol = declaredChoice(env, "SHELF_REMOTE_BROWSER_PROTOCOL", ["playwright", "cdp"]);
  const reach = declaredChoice(env, "SHELF_REMOTE_BROWSER_REACH", ["loopback", "url"]);
  assertReach(env, protocol, reach);
  const endpoint = remoteEndpoint(env, protocol);
  const token = nonEmpty(readSetting(env, "SHELF_REMOTE_BROWSER_TOKEN"));
  return buildRemote(env, { protocol, reach, endpoint, token });
}

/** What the declared reach needs: CDP cannot loop back, and a URL needs a secret and an origin. */
function assertReach(env: Env, protocol: RemoteProtocol, reach: "loopback" | "url"): void {
  if (protocol === "cdp" && reach === "loopback") {
    throw new BootRefusal(
      "SHELF_REMOTE_BROWSER_REACH=loopback needs SHELF_REMOTE_BROWSER_PROTOCOL=playwright",
    );
  }
  if (reach === "url") {
    assertUrlReach(env);
  }
}

/** `remote()` over the checked values; its own messages are never forwarded, as one could quote the endpoint. */
function buildRemote(
  env: Env,
  {
    protocol,
    reach,
    endpoint,
    token,
  }: {
    protocol: RemoteProtocol;
    reach: "loopback" | "url";
    endpoint: string;
    token: string | undefined;
  },
): RemoteBrowser {
  const options = {
    name: remoteName(env),
    engines: remoteEngines(env, protocol),
    protocol,
    reach,
    sessions: remoteCount(env, "SHELF_REMOTE_BROWSER_SESSIONS") ?? 1,
    maxConnections: remoteCount(env, "SHELF_REMOTE_BROWSER_MAX_CONNECTIONS"),
    connect: {
      endpoint,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    },
  };
  try {
    return remote(options);
  } catch {
    throw new BootRefusal(
      "The SHELF_REMOTE_BROWSER_* variables do not describe a valid remote browser",
    );
  }
}

/** Both Azure Playwright Workspace variables are set. */
function azureConfigured(env: Env): boolean {
  return (
    nonEmpty(env["PLAYWRIGHT_SERVICE_URL"]) !== undefined &&
    nonEmpty(env["PLAYWRIGHT_SERVICE_ACCESS_TOKEN"]) !== undefined
  );
}

/**
 * The runner's `browsers`: the bundled Chromium, then the generic remote browser the
 * `SHELF_REMOTE_BROWSER_*` variables declare, then `chromium@azure` when an Azure Playwright
 * Workspace is configured.
 */
export function browsersFromEnv(env: Env): (BrowserName | RemoteBrowser)[] {
  const browsers: (BrowserName | RemoteBrowser)[] = ["chromium"];
  const generic = remoteBrowserFromEnv(env);
  if (generic !== undefined) {
    browsers.push(generic);
  }
  const endpoint = nonEmpty(env["PLAYWRIGHT_SERVICE_URL"]);
  const token = nonEmpty(env["PLAYWRIGHT_SERVICE_ACCESS_TOKEN"]);
  if (endpoint !== undefined && token !== undefined) {
    browsers.push(azurePlaywright({ endpoint, token, engines: ["chromium"] }));
  }
  return browsers;
}

/** How the image signs people in: the local password admin, or nobody (an explicit `SHELF_AUTH=none`). */
export type ImageAuth =
  | { mode: "password"; password: string; email: string; secret: string }
  | { mode: "none" };

/** The shortest `SHELF_SECRET` sign-in accepts (the auth engine's own rule). */
const MIN_SECRET_LENGTH = 32;

const AUTH_MODE_HINT =
  "set SHELF_ADMIN_PASSWORD and SHELF_SECRET (at least 32 characters) to sign in, or SHELF_AUTH=none to run with every route open";

/**
 * Sign-in is on unless `SHELF_AUTH=none` says otherwise: a missing variable never turns it off.
 * `SHELF_SECRET` must be at least 32 characters; `createShelfAuth` checks it again.
 */
export function authFromEnv(env: Env): ImageAuth {
  const mode = nonEmpty(env["SHELF_AUTH"]) ?? "password";
  const password = nonEmpty(readSetting(env, "SHELF_ADMIN_PASSWORD"));
  if (mode === "none") {
    if (password !== undefined) {
      throw new BootRefusal(
        "SHELF_AUTH=none and SHELF_ADMIN_PASSWORD are both set: unset one of them",
      );
    }
    return { mode: "none" };
  }
  if (mode !== "password") {
    throw new BootRefusal("SHELF_AUTH must be password (the default) or none");
  }
  return passwordAuth(env, password);
}

/** The password mode's settings: SHELF_ADMIN_PASSWORD and SHELF_SECRET are both required. */
function passwordAuth(env: Env, password: string | undefined): ImageAuth {
  const secret = nonEmpty(readSetting(env, "SHELF_SECRET"));
  if (password === undefined) {
    throw new BootRefusal(`SHELF_ADMIN_PASSWORD is unset: ${AUTH_MODE_HINT}`);
  }
  if (secret === undefined) {
    throw new BootRefusal(`SHELF_SECRET is unset: ${AUTH_MODE_HINT}`);
  }
  // Checked again by createShelfAuth; refused here too, before any adapter is created.
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new BootRefusal(
      `SHELF_SECRET is shorter than ${MIN_SECRET_LENGTH} characters: ${AUTH_MODE_HINT}`,
    );
  }
  return {
    mode: "password",
    password,
    email: nonEmpty(readSetting(env, "SHELF_ADMIN_EMAIL")) ?? "admin@example.com",
    secret,
  };
}

/** Whether a listen address reaches only this machine (so an open server is not exposed). */
export function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}
