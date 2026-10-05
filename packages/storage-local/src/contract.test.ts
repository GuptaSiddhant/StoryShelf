import { storageContractSuite } from "@storyshelf/core/test-helpers";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStorage } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "storage-local-contract-"));

storageContractSuite("local", () => createLocalStorage(root));
