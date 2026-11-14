/**
 * RDS / Aurora Postgres preset using short-lived IAM authentication tokens.
 *
 * Same schema, DDL and Drizzle factory as the `pg` preset; the password is an IAM token that
 * `node-postgres` asks for on every new connection, so a pooled connection never opens with a stale
 * one (tokens live 15 minutes). Credentials come from the standard AWS chain (ECS task role,
 * instance role, web identity). Requires the optional `pg` and `@aws-sdk/rds-signer` peers.
 *
 * The server certificate is always verified, against the bundled Amazon RDS root certificates (GovCloud's for `us-gov-*`) or the
 * `ca` you give. The IAM token is a credential, so the preset never connects encrypted but
 * unverified unless `verifyServerCertificate: false` asks for it, and that logs a warning.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
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
  /**
   * Set `false` to connect encrypted but without checking the server certificate. Off by default
   * and logged as a warning: anyone who can intercept the connection can then take the IAM token.
   * Ignored when `ca` is given, which always verifies.
   */
  verifyServerCertificate?: boolean;
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
  const adapter = createPgDatabase({
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
  return skipsVerification(options) ? warnWhenUnverified(adapter) : adapter;
}

/** Whether the options opt out of verifying the server certificate (and give no `ca` to verify by). */
function skipsVerification(options: RdsIamDatabaseOptions): boolean {
  return options.verifyServerCertificate === false && options.ca === undefined;
}

/** TLS settings: verified against `ca` or the bundled RDS roots; unverified only on an explicit opt-out. */
function sslOf(options: RdsIamDatabaseOptions): {
  ca?: string | string[];
  rejectUnauthorized: boolean;
} {
  if (skipsVerification(options)) {
    return { rejectUnauthorized: false };
  }
  return { ca: options.ca ?? caBundleFor(options.region), rejectUnauthorized: true };
}

const UNVERIFIED_WARNING =
  "rds-iam: verifyServerCertificate is false; the connection is encrypted but the database server is not verified, so a network attacker can take the IAM token. Remove the option to verify against the bundled Amazon RDS roots, or pass `ca`.";

/**
 * Log the opt-out once, with the host's logger (bound by `setLogger` or handed to `setup`). The
 * result inherits from the adapter instead of copying it: its retention capability is a live getter
 * and its own properties are fixed, so a copy would freeze the one and could not replace the other.
 */
function warnWhenUnverified(adapter: DatabaseAdapter): DatabaseAdapter {
  let warned = false;
  const warn = (logger: Logger | undefined): void => {
    if (!warned && logger !== undefined) {
      warned = true;
      logger.warn(UNVERIFIED_WARNING);
    }
  };
  const { lifecycle } = adapter;
  const wrapped: PropertyDescriptorMap = {
    setLogger: {
      enumerable: true,
      value: (logger: Logger): void => {
        adapter.setLogger?.(logger);
        warn(logger);
      },
    },
  };
  if (lifecycle !== undefined) {
    wrapped["lifecycle"] = {
      enumerable: true,
      value: {
        ...lifecycle,
        setup: async (
          context: Parameters<NonNullable<typeof lifecycle.setup>>[0],
        ): Promise<void> => {
          warn(context.logger);
          await lifecycle.setup?.(context);
        },
      },
    };
  }
  return Object.create(adapter, wrapped) as DatabaseAdapter;
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
