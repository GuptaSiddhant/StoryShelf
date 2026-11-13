import { PGlite } from "@electric-sql/pglite";
import { createShelfLogger } from "@storyshelf/core/logger";
import { retentionSkippedContractSuite } from "@storyshelf/core/test-helpers";
import { drizzle } from "drizzle-orm/pglite";
import { vi } from "vitest";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createPgliteDatabase } from "./pglite.ts";
import { schema } from "./schema/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// PGlite never exposes the capability itself (one session proves no locking), so the lifecycle is
// attached here to prove the cascade's SQL on Postgres.
retentionSkippedContractSuite("pglite", async (use) => {
  const client = new PGlite();
  try {
    const adapter = createPgliteDatabase({ client });
    await adapter.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    const lifecycle = createBuildReferenceLifecycle(drizzle(client, { schema }));
    await use({ ...adapter, buildReferenceLifecycle: lifecycle });
  } finally {
    await client.close();
  }
});
