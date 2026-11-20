/**
 * RDS / Aurora Postgres preset using short-lived IAM authentication tokens.
 *
 * Same schema, DDL and Drizzle factory as the `pg` preset; the password is an IAM token that
 * `node-postgres` asks for on every new connection, so a pooled connection never opens with a stale
 * one (tokens live 15 minutes). Credentials come from the standard AWS chain (ECS task role,
 * instance role, web identity). Requires the optional `pg` and `@aws-sdk/rds-signer` peers.
 *
 * The server certificate is always verified, against the bundled Amazon RDS root certificates
 * (GovCloud's for `us-gov-*`) or the `ca` you give. The IAM token is a credential, so the preset
 * never connects encrypted but unverified, and there is no option to ask for that.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { redactSecrets } from "@storyshelf/core/utils";
import { createPgDatabase } from "./pg.ts";
import { caBundleFor } from "./rds-ca-bundle.ts";

/** Anything that mints an RDS IAM token; `@aws-sdk/rds-signer`'s `Signer` fits, so does a fake. */
export interface RdsTokenSigner {
  getAuthToken(): Promise<string>;
}

/** Options for {@link createRdsIamDatabase}. */
export interface RdsIamDatabaseOptions {
  host: string;
  port?: number;
  database: string;
  user: string;
  /** AWS region of the instance or cluster, e.g. `eu-west-1`. */
  region: string;
  /**
   * CA certificate(s) (PEM) that replace the bundled Amazon RDS roots, for a proxy, a custom domain
   * or a certificate AWS has not bundled yet. The server certificate is verified against them.
   */
  ca?: string | string[];
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  /** Replace the AWS signer (tests, custom credential providers). */
  signer?: RdsTokenSigner;
}

const INSTALL_HINT =
  "rds-iam: the optional peer `@aws-sdk/rds-signer` is not installed. Run `nub add @aws-sdk/rds-signer` (or your package manager's equivalent).";

/**
 * Create an RDS-IAM-backed DatabaseAdapter.
 *
 * @param options - Instance address, database user, region and optional CA bundle.
 * @returns A DatabaseAdapter whose every new connection authenticates with a fresh IAM token.
 */
export function createRdsIamDatabase(options: RdsIamDatabaseOptions): DatabaseAdapter {
  return createPgDatabase({
    host: options.host,
    port: options.port ?? 5432,
    database: options.database,
    user: options.user,
    password: tokenSource(options),
    ssl: sslOf(options),
    max: options.max,
    idleTimeoutMillis: options.idleTimeoutMillis,
    connectionTimeoutMillis: options.connectionTimeoutMillis,
  });
}

/** TLS settings: always verified, against `ca` or the bundled RDS roots for the region. */
function sslOf(options: RdsIamDatabaseOptions): {
  ca: string | string[];
  rejectUnauthorized: true;
} {
  if (options.ca !== undefined && isBlank(options.ca)) {
    throw new Error(
      "rds-iam: `ca` is empty; pass the PEM certificate(s) or omit it for the bundled RDS roots",
    );
  }
  return { ca: options.ca ?? caBundleFor(options.region), rejectUnauthorized: true };
}

/** A `ca` with no certificate text would leave the server unverified against anything useful. */
function isBlank(ca: string | string[]): boolean {
  return (Array.isArray(ca) ? ca : [ca]).every((pem) => pem.trim() === "");
}

/** The password function `pg` calls per connection: a fresh token, never cached, never in errors. */
function tokenSource(options: RdsIamDatabaseOptions): () => Promise<string> {
  let signer = options.signer;
  const sign = async (): Promise<string> => {
    signer ??= await loadSigner(options);
    return signer.getAuthToken();
  };
  return async () => await sign().catch(rethrowScrubbed);
}

/** Rethrow as a new error without the original, which may carry a token in its text or cause. */
function rethrowScrubbed(error: unknown): never {
  throw new Error(scrub(error));
}

async function loadSigner(options: RdsIamDatabaseOptions): Promise<RdsTokenSigner> {
  let module: typeof import("@aws-sdk/rds-signer");
  try {
    module = await import("@aws-sdk/rds-signer");
  } catch {
    throw new Error(INSTALL_HINT);
  }
  return new module.Signer({
    hostname: options.host,
    port: options.port ?? 5432,
    username: options.user,
    region: options.region,
  });
}

/** Error text with any token-shaped secret removed; the original error is not chained. */
function scrub(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return redactSecrets(`rds-iam: ${text.replace(/^rds-iam: /u, "")}`);
}
