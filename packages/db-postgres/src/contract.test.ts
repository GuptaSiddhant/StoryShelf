import { databaseContractSuite } from "@storyshelf/core/test-helpers";
import { createPgliteDatabase } from "./pglite.ts";

databaseContractSuite("pglite", () => createPgliteDatabase());
