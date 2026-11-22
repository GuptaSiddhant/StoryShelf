import { createShelfLogger } from "@storyshelf/core/logger";
import { retentionSkippedContractSuite } from "@storyshelf/core/test-helpers";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createSqliteDatabase } from "./index.ts";

retentionSkippedContractSuite("sqlite", async (use) => {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-retention-skipped-"));
  const path = join(dir, "test.sqlite");
  const sqlite = createSqliteDatabase(path);
  try {
    await sqlite.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    await use({ ...sqlite, buildReferenceLifecycle: createBuildReferenceLifecycle(path) });
  } finally {
    await sqlite.lifecycle?.teardown();
    rmSync(dir, { recursive: true, force: true });
  }
});
