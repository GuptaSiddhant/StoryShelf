// Entry of `migrate-to-s3.sh`: copies the volume's storage tree to the bucket named by the app's
// own S3 environment (`AWS_BUCKET`, `AWS_*`), through the same adapters the server uses.
import { createLocalStorage } from "@storyshelf/storage-local";
import { migrateStorage } from "./migrate.ts";
import { storageFromEnv } from "./storage.ts";

const env = process.env;
const dryRun = process.argv.includes("--dry-run");
const dataDir = env["DATA_DIR"] ?? "/data";
const target = storageFromEnv(env, dataDir);
if (target.log.storage !== "s3") {
  throw new Error("AWS_BUCKET is not set: nothing to migrate to.");
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
