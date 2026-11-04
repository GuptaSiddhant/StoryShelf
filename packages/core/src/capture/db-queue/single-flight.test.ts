import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { databaseQueueSingleFlightSuite } from "../../test-helpers/queue-single-flight.ts";

// The in-memory fake enforces the unique `active_key` like a real database does, so the shared
// suite runs here without a driver; db-sqlite and db-postgres run it against theirs.
databaseQueueSingleFlightSuite("in-memory fake", () => makeDatabase().db);
