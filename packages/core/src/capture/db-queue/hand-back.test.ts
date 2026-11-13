import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { databaseQueueHandBackSuite } from "../../test-helpers/queue-hand-back.ts";

// The in-memory fake stands in for MySQL (no driver runs in unit tests); db-sqlite and db-postgres
// run the same suite against theirs.
databaseQueueHandBackSuite("in-memory fake", () => makeDatabase().db);
