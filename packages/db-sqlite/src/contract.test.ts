import { databaseContractSuite } from "@storyshelf/core/test-helpers";
import { createSqliteDatabase } from "./index.ts";

databaseContractSuite("sqlite", () => createSqliteDatabase(":memory:"));
