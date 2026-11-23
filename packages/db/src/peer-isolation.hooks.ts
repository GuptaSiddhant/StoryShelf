/**
 * Node module-resolution hook for `peer-isolation.test.ts`: makes the peers that a subpath must not
 * load unresolvable, so an import of that subpath fails if it reaches for them. `SHELF_BLOCKED_PEERS`
 * is a comma-separated list of package names; `SHELF_RESOLVED_FILE` receives every peer that did resolve.
 */
import { appendFileSync } from "node:fs";

type NextResolve = (specifier: string, context: object) => Promise<unknown>;

const blocked = (process.env["SHELF_BLOCKED_PEERS"] ?? "").split(",").filter(Boolean);
const log = process.env["SHELF_RESOLVED_FILE"];
const PEERS = [
  "@aws-sdk/rds-signer",
  "@electric-sql/pglite",
  "@libsql/client",
  "@neondatabase/serverless",
  "@planetscale/database",
  "@tidbcloud/serverless",
  "@vercel/postgres",
  "better-sqlite3",
  "mysql2",
  "pg",
  "postgres",
];

const isPackage = (specifier: string, name: string): boolean =>
  specifier === name || specifier.startsWith(`${name}/`);

export async function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: NextResolve,
): Promise<unknown> {
  // Only the package's own imports are policed: a peer's transitive dependencies (`@vercel/postgres`
  // loads `@neondatabase/serverless`) live in node_modules and may use any other peer.
  const own = !(context.parentURL ?? "").includes("/node_modules/");
  if (own && blocked.some((name) => isPackage(specifier, name))) {
    throw new Error(`blocked peer: ${specifier}`);
  }
  if (log !== undefined && PEERS.some((name) => isPackage(specifier, name))) {
    appendFileSync(log, `${specifier}\n`);
  }
  return await nextResolve(specifier, context);
}
