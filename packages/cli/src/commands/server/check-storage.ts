import { createClient } from "../../client.ts";
import { printLine } from "../../output.ts";

interface CheckStorageResponse {
  buildsChecked: number;
  baselinesChecked: number;
  builds: { buildId: string; missing: number }[];
  unreadableManifests: string[];
  missingBaselineImages: number;
  unreferencedBlobs: number;
  sampled: boolean;
}

/** Options for `storyshelf server check-storage`. */
export interface ServerCheckStorageOptions {
  url: string;
  token?: string;
  /** Check only the newest n builds. */
  sample?: number;
}

/**
 * Ask the server whether storage holds what its database references. Read-only; sets a non-zero
 * exit code when a blob or baseline image is missing or a manifest is unreadable.
 */
export async function runServerCheckStorage(options: ServerCheckStorageOptions): Promise<void> {
  const token =
    options.token ?? process.env["STORYSHELF_ADMIN_TOKEN"] ?? process.env["ADMIN_TOKEN"];
  const client = createClient(options.url, token);
  const sample = options.sample;
  const report = (await client.projects.admin.checkStorage(
    sample === undefined || Number.isNaN(sample) ? {} : { sample },
  )) as CheckStorageResponse;
  printReport(report);
  const broken =
    report.builds.length + report.unreadableManifests.length + report.missingBaselineImages;
  if (broken > 0) process.exitCode = 1;
}

function printReport(report: CheckStorageResponse): void {
  printLine(`Checked ${report.buildsChecked} build(s) and ${report.baselinesChecked} baseline(s)`);
  for (const build of report.builds) {
    printLine(`Build ${build.buildId}: ${build.missing} blob(s) missing from storage`);
  }
  for (const id of report.unreadableManifests) printLine(`Build ${id}: manifest unreadable`);
  printLine(`Baseline images missing: ${report.missingBaselineImages}`);
  printLine(
    report.sampled
      ? "Unreferenced blobs: not counted (sampled run)"
      : `Unreferenced blobs: ${report.unreferencedBlobs}`,
  );
  if (
    report.builds.length + report.unreadableManifests.length + report.missingBaselineImages ===
    0
  ) {
    printLine("Storage is consistent with the database.");
  }
}
