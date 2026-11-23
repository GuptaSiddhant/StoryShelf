import { readSetting } from "@storyshelf/core/config";
// Entry of `migrate-to-s3.sh`: copies the volume's storage tree to the bucket named by the app's
// own S3 environment (`SHELF_S3_BUCKET`, `AWS_*`), through the same adapters the server uses.
import { createLocalStorage } from "@storyshelf/core/storage/local";
import { migrateStorage } from "./migrate.ts";
import { storageFromEnv } from "./storage.ts";

const env = process.env;
const dryRun = process.argv.includes("--dry-run");
const dataDir = readSetting(env, "SHELF_DATA_DIR") ?? "/data";
const target = storageFromEnv(env, dataDir);
if (target.log.storage !== "s3") {
  throw new Error("SHELF_S3_BUCKET is not set: nothing to migrate to.");
}
const result = await migrateStorage(createLocalStorage(dataDir), target.storage, { dryRun });
// Counts and the endpoint origin only: never a key, the bucket or a credential.
process.stdout.write(
  `${JSON.stringify({
    dryRun,
    copied: result.copied.length,
    skipped: result.skipped.length,
    ignored: result.ignored.length,
    endpointOrigin: target.log.endpointOrigin,
  })}\n`,
);
