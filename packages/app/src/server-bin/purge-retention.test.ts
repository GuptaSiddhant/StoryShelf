import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { instanceDir, recordingIo, tablesOf } from "./__fixtures__/instance-dir.ts";
import { runServerBin } from "./main.ts";

// A source run reports 0.0.0, which has no schema level; pin a release so `migrate` records one.
vi.mock("../package-version.ts", () => ({ packageVersion: () => "1.2.3" }));

const runner = fileURLToPath(new URL("../test-runner.ts", import.meta.url));

/** A testing instance over SQLite and local storage: `purge` needs the fenced lifecycle here. */
function testingInstance(): ReturnType<typeof instanceDir> {
  return instanceDir({
    source: `import { defineShelfInstance } from "\${APP}";
import { fixtureOptions } from "\${FIXTURE}";
import { stubRunner } from ${JSON.stringify(runner)};
export default defineShelfInstance(async () => ({
  ...fixtureOptions("\${DATA}"),
  testing: { runner: stubRunner() },
}));
`,
  });
}

describe("purge on SQLite with testing", () => {
  it("works on a file this release migrated, as the running server does", async () => {
    const { dir } = testingInstance();
    {
      const m = recordingIo();
      const c = await runServerBin(["migrate", "--dir", dir], m, {});
      expect([c, m.stderr]).toEqual([0, []]);
    }

    const io = recordingIo();
    expect(await runServerBin(["purge", "--dir", dir], io, {})).toBe(0);
    expect(io.stdout).toEqual(["Removed 0 build(s), 0 branch(es) and 0 baseline(s)"]);
    expect(io.stderr).toEqual([]);
  });

  it("works while another connection holds the file open, as beside a running server", async () => {
    const { dir, dataDir } = testingInstance();
    {
      const m = recordingIo();
      const c = await runServerBin(["migrate", "--dir", dir], m, {});
      expect([c, m.stderr]).toEqual([0, []]);
    }
    const server = new DatabaseSync(join(dataDir, "shelf.db"));
    try {
      expect(await runServerBin(["purge", "--dir", dir], recordingIo(), {})).toBe(0);
    } finally {
      server.close();
    }
  });

  it("refuses an unmigrated file with one plain line, exit 1, and leaves it untouched", async () => {
    const { dir, dataDir } = testingInstance();
    const io = recordingIo();

    expect(await runServerBin(["purge", "--dir", dir], io, {})).toBe(1);

    expect(io.stderr).toHaveLength(1);
    expect(io.stderr[0]).toMatch(/^storyshelf-server purge: Build retention is not prepared/u);
    expect(io.stderr[0]).toContain("storyshelf-server serve");
    expect(io.stderr[0]).toContain("storyshelf-server migrate");
    expect(io.stderr[0]).not.toContain("{");
    expect(tablesOf(dataDir)).toEqual([]);
  });

  it("refuses a file an older release migrated", async () => {
    const { dir, dataDir } = testingInstance();
    {
      const m = recordingIo();
      const c = await runServerBin(["migrate", "--dir", dir], m, {});
      expect([c, m.stderr]).toEqual([0, []]);
    }
    const db = new DatabaseSync(join(dataDir, "shelf.db"));
    db.prepare("UPDATE schema_meta SET version = '1.1.9'").run();
    db.close();

    const io = recordingIo();
    expect(await runServerBin(["purge", "--dir", dir], io, {})).toBe(1);
    expect(io.stderr[0]).toMatch(/not migrated by this release/u);
  });
});
