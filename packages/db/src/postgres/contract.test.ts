import {
  buildLifecycleContractSuite,
  databaseContractSuite,
  pushSubscriptionContractSuite,
} from "@storyshelf/core/test-helpers";
import { createPostgresDatabase } from "./index.ts";
import { createPgliteDatabase } from "./pglite.ts";

databaseContractSuite("pglite", () => createPgliteDatabase());
buildLifecycleContractSuite("pglite", () => createPgliteDatabase());
pushSubscriptionContractSuite("pglite", () => createPgliteDatabase());

// Real Postgres, on the same disposable database the live lifecycle suite uses (see
// build-reference-lifecycle.test.ts): the pair test only creates its own projects and builds.
const LIVE =
  process.env["LIVE_CLOUD"] === "1" &&
  process.env["POSTGRES_SCHEMA_MUTATION_TEST"] === "1" &&
  process.env["DATABASE_URL"] !== undefined;
if (LIVE) {
  buildLifecycleContractSuite("postgres", () =>
    createPostgresDatabase({ url: process.env["DATABASE_URL"] ?? "" }),
  );
}
