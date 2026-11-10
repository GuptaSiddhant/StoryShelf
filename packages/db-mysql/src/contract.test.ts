/**
 * The shared database contract suite against a real MySQL, like the SQLite and Postgres adapters.
 *
 * Gated on `MYSQL_URL` (`mysql://user:pass@host:3306/db`), so hermetic `nub run test` never touches
 * MySQL: without it the whole suite is skipped. Point it at a disposable database; the nightly
 * `nightly-db.yml` MySQL job does, with its own database so it cannot collide with the live suite.
 *
 *   docker run -d --name shelf-mysql -p 127.0.0.1:3306:3306 -e MYSQL_ROOT_PASSWORD=pw -e MYSQL_DATABASE=shelf mysql:8.0
 *   (wait until it accepts connections, see docs/testing.md)
 *   MYSQL_URL=mysql://root:pw@127.0.0.1:3306/shelf nubx vitest run src/contract.test.ts
 *
 * Run vitest directly: `nub run test` goes through turbo, which does not pass `MYSQL_URL` on.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { databaseContractSuite } from "@storyshelf/core/test-helpers";
import { afterAll, describe } from "vite-plus/test";
import { createMysqlDatabase } from "./index.ts";

const url = process.env["MYSQL_URL"];

describe.skipIf(url === undefined || url === "")(
  "mysql contract (real MySQL, gated on MYSQL_URL)",
  () => {
    const created: DatabaseAdapter[] = [];

    // The suite builds one adapter per case and some cases never tear theirs down. `teardown` is
    // idempotent, so one that already ran returns at once. Every adapter is attempted, and a failed
    // close is reported afterwards (not swallowed), so a leaked pool shows up as a failure.
    afterAll(async () => {
      const results = await Promise.allSettled(
        created.map(async (adapter) => await adapter.lifecycle?.teardown()),
      );
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason as unknown] : [],
      );
      if (failures.length > 0) {
        throw new AggregateError(failures, "Database adapter teardown failed");
      }
    });

    databaseContractSuite("mysql", () => {
      const adapter = createMysqlDatabase({ url: url ?? "" });
      created.push(adapter);
      return adapter;
    });
  },
);
