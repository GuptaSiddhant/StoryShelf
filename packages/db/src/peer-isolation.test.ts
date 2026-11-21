import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/** Every optional peer, by the subpath that owns it: a subpath may load only its own. */
const PEERS = {
  sqlite: [],
  "sqlite/turso": ["@libsql/client"],
  "sqlite/better-sqlite3": ["better-sqlite3"],
  "sqlite/d1": [],
  postgres: ["postgres"],
  "postgres/pg": ["pg"],
  "postgres/neon": ["@neondatabase/serverless"],
  "postgres/neon-http": ["@neondatabase/serverless"],
  "postgres/vercel": ["@vercel/postgres"],
  "postgres/pglite": ["@electric-sql/pglite"],
  "postgres/rds-iam": ["pg", "@aws-sdk/rds-signer"],
  mysql: ["mysql2"],
  "mysql/planetscale": ["mysql2", "@planetscale/database"],
  "mysql/tidb": ["mysql2", "@tidbcloud/serverless"],
} as const satisfies Record<string, readonly string[]>;

type Subpath = keyof typeof PEERS;

/**
 * Presets that import their peers only when a factory runs, so importing the subpath proves
 * isolation (nothing else resolves) but loads none of its own. `sqlite/bun-sqlite` is left out: it
 * imports `bun:sqlite`, which only Bun resolves.
 */
const LAZY: readonly Subpath[] = [
  "sqlite/turso",
  "postgres/rds-iam",
  "mysql/planetscale",
  "mysql/tidb",
];

const hooks = pathToFileURL(join(import.meta.dirname, "peer-isolation.hooks.ts")).href;
const packageDir = join(import.meta.dirname, "..");

/** Import `@storyshelf/db/<subpath>` in a fresh Node with every other subpath's peers unresolvable. */
function importWithOnlyOwnPeers(subpath: Subpath): {
  status: number | null;
  log: string;
  err: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "shelf-peers-"));
  const resolved = join(dir, "resolved.txt");
  writeFileSync(resolved, "");
  const register = `import { register } from "node:module"; register(${JSON.stringify(hooks)});`;
  // A peer is blocked unless this subpath owns it (two presets may share one, e.g. `pg`).
  const own: readonly string[] = PEERS[subpath];
  const blocked = [...new Set(Object.values(PEERS).flat())].filter((peer) => !own.includes(peer));
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=source",
      "--no-warnings",
      "--input-type=module",
      "-e",
      `${register} await import("@storyshelf/db/${subpath}");`,
    ],
    {
      cwd: packageDir,
      encoding: "utf8",
      env: {
        ...process.env,
        SHELF_BLOCKED_PEERS: blocked.join(","),
        SHELF_RESOLVED_FILE: resolved,
      },
    },
  );
  const log = readFileSync(resolved, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, log, err: result.stderr };
}

describe("optional peers load only from their own subpath", () => {
  for (const subpath of Object.keys(PEERS) as Subpath[]) {
    it(`/${subpath} imports with only its own peers resolvable`, () => {
      const { status, log, err } = importWithOnlyOwnPeers(subpath);
      expect(err).toBe("");
      expect(status).toBe(0);
      // The block list made every other peer unresolvable, so reaching one would have thrown above;
      // here, check the subpath did load its own (peers' own transitive packages are not listed).
      const loaded = log.split("\n").filter(Boolean);
      for (const peer of LAZY.includes(subpath) ? [] : PEERS[subpath]) {
        expect(loaded.some((name) => name === peer || name.startsWith(`${peer}/`))).toBe(true);
      }
    }, 60_000);
  }
});
