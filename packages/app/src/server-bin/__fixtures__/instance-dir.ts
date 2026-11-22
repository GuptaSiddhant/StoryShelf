import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Io } from "../io.ts";

const fixture = fileURLToPath(new URL("instance-app.ts", import.meta.url));
const appIndex = fileURLToPath(new URL("../../index.tsx", import.meta.url));

/** A scratch instance project: its directory and the data directory its options use. */
export interface InstanceDir {
  dir: string;
  dataDir: string;
}

interface InstanceDirOptions {
  /** Full source of `src/index.ts`; `${DATA}` is the data directory, `${APP}` and `${FIXTURE}` import paths. */
  source?: string;
  /** Add an `afterSetup` hook that writes `after-setup.txt` into the data directory. */
  afterSetup?: boolean;
}

/** The marker file the `afterSetup` hook writes. */
export function afterSetupMarker(dataDir: string): string {
  return join(dataDir, "after-setup.txt");
}

/** A directory whose `src/index.ts` defines the real fixture instance (or `options.source`). */
export function instanceDir(options: InstanceDirOptions = {}): InstanceDir {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-instance-"));
  const dataDir = join(dir, "data");
  mkdirSync(join(dir, "src"));
  mkdirSync(dataDir);
  const hook = options.afterSetup
    ? `, { afterSetup: async () => { writeFileSync(${JSON.stringify(afterSetupMarker(dataDir))}, "ran"); } }`
    : "";
  const source =
    options.source ??
    `import { writeFileSync } from "node:fs";
import { defineShelfInstance } from "\${APP}";
import { fixtureOptions } from "\${FIXTURE}";
export default defineShelfInstance(async () => fixtureOptions("\${DATA}")${hook});
`;
  writeFileSync(
    join(dir, "src/index.ts"),
    source
      .replaceAll("${APP}", appIndex)
      .replaceAll("${FIXTURE}", fixture)
      .replaceAll("${DATA}", dataDir),
  );
  return { dir, dataDir };
}

/** Record `release` as the one that migrated the instance's SQLite file (a source run records none). */
export function recordRelease(dataDir: string, release: string): void {
  const db = new DatabaseSync(join(dataDir, "shelf.db"));
  try {
    db.prepare(
      "INSERT INTO schema_meta (id, version, migrated_at) VALUES ('schema', ?, '2026-11-21T00:00:00.000Z')",
    ).run(release);
  } finally {
    db.close();
  }
}

/** The tables of the instance's SQLite file (none until something migrated it). */
export function tablesOf(dataDir: string): string[] {
  if (!existsSync(join(dataDir, "shelf.db"))) return [];
  const db = new DatabaseSync(join(dataDir, "shelf.db"), { readOnly: true });
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    return rows.map((row) => row.name);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** An {@link Io} that records its lines. */
export function recordingIo(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    out: (line) => {
      stdout.push(line);
    },
    err: (line) => {
      stderr.push(line);
    },
    stdout,
    stderr,
  };
}
