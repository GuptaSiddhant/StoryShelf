import { adminCall } from "../admin-call.ts";
import type { ServerFlags } from "../args.ts";
import { loadInstance } from "../instance.ts";
import type { Io } from "../io.ts";

/** The consistency report of `/api/v1/admin/check-storage`. */
export interface StorageReport {
  buildsChecked: number;
  baselinesChecked: number;
  builds: { buildId: string; missing: number }[];
  unreadableManifests: string[];
  missingBaselineImages: number;
  unreferencedBlobs: number;
  sampled: boolean;
}

/** How many problems the report holds: missing blobs, unreadable manifests, missing baseline images. */
export function problemsIn(report: StorageReport): number {
  return report.builds.length + report.unreadableManifests.length + report.missingBaselineImages;
}

/** Print the report, one line per finding. */
export function printStorageReport(report: StorageReport, io: Io): void {
  io.out(`Checked ${report.buildsChecked} build(s) and ${report.baselinesChecked} baseline(s)`);
  for (const build of report.builds) {
    io.out(`Build ${build.buildId}: ${build.missing} blob(s) missing from storage`);
  }
  for (const id of report.unreadableManifests) io.out(`Build ${id}: manifest unreadable`);
  io.out(`Baseline images missing: ${report.missingBaselineImages}`);
  io.out(
    report.sampled
      ? "Unreferenced blobs: not counted (sampled run)"
      : `Unreferenced blobs: ${report.unreferencedBlobs}`,
  );
  if (problemsIn(report) === 0) io.out("Storage is consistent with the database.");
}

/** `check-storage`: read-only; exits 1 when a blob or baseline image is missing or a manifest unreadable. */
export async function checkStorage(flags: ServerFlags, io: Io): Promise<number> {
  const { app } = await loadInstance(flags.dir ?? process.cwd());
  try {
    await app.lifecycle.setup();
    const report = await adminCall<StorageReport>(
      app,
      "/api/v1/admin/check-storage",
      flags.sample === undefined ? {} : { sample: flags.sample },
    );
    printStorageReport(report, io);
    return problemsIn(report) > 0 ? 1 : 0;
  } finally {
    await app.lifecycle.teardown();
  }
}
