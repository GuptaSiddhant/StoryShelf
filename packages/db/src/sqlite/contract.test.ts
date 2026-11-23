import {
  buildLifecycleContractSuite,
  databaseContractSuite,
  pushSubscriptionContractSuite,
} from "@storyshelf/core/test-helpers";
import { createSqliteDatabase } from "./index.ts";

databaseContractSuite("sqlite", () => createSqliteDatabase(":memory:"));
buildLifecycleContractSuite("sqlite", () => createSqliteDatabase(":memory:"));
pushSubscriptionContractSuite("sqlite", () => createSqliteDatabase(":memory:"));
