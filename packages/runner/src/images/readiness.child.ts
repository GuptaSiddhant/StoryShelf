/**
 * Run by `readiness.test.ts` in a fresh Node with some image libraries unresolvable: boot
 * `createShelfApp` with `testing` and a runner carrying this package's image engine, then print
 * the readiness outcome as a JSON report on stdout.
 */
import { createShelfApp } from "@storyshelf/app";
import { createShelfLogger } from "@storyshelf/core/logger";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { createImageEngine } from "./index.ts";

const { db } = makeDatabase();
const app = createShelfApp({
  database: db,
  storage: makeStorage().storage,
  logger: createShelfLogger({ level: "silent" }),
  testing: {
    runner: {
      metadata: { name: "images", version: "0.0.0", kind: "stub", category: "capture-runner" },
      render: async () => await Promise.resolve({ captures: [], failures: [] }),
      cancel: async () => {},
      images: createImageEngine(),
    },
  },
});
const setup = await app.lifecycle.ready.then(
  (result) => (result.ok ? "ok" : result.failures.map((failure) => failure.error).join("; ")),
  (error: unknown) => (error instanceof Error ? error.message : String(error)),
);
await app.lifecycle.teardown();
process.stdout.write(`REPORT ${JSON.stringify({ setup })}\n`);
// oxlint-disable-next-line unicorn/no-process-exit -- adapter timers would keep this one-shot child alive
process.exit(0);
