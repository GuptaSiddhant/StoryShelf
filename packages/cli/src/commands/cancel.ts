import { createClient, type CancelOlderResult } from "../client.ts";
import { createReporter, printLine } from "../output.ts";
import { resolveConnection, type ConnectionOptions } from "./connection.ts";

/** Options for the `cancel` command. */
export interface CancelOptions extends ConnectionOptions {
  /** Only cancel builds of this branch. */
  branch?: string;
  /** Unfinished builds to keep per branch, as the flag's text (default 1). */
  keepNewest?: string;
  /** List what would be cancelled without cancelling it. */
  dryRun?: boolean;
}

/** Parse `--keep-newest`: a whole number of at least 0, or the server default when absent. */
function parseKeepNewest(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError(`--keep-newest must be a whole number of 0 or more, got "${value}"`);
  }
  return parsed;
}

/**
 * Cancel the older unfinished builds of a project (pending, capturing or comparing), keeping the
 * newest of each branch. Finished builds are never touched. `--dry-run` only prints the list.
 *
 * @param options - Cancel command options.
 */
export async function runCancel(options: CancelOptions): Promise<void> {
  const keepNewest = parseKeepNewest(options.keepNewest);
  const { url, slug, token } = await resolveConnection(options);
  const dryRun = options.dryRun === true;
  const input = {
    ...(options.branch === undefined ? {} : { branch: options.branch }),
    ...(keepNewest === undefined ? {} : { keepNewest }),
    dryRun,
  };
  const [open, done] = dryRun
    ? ["Finding older unfinished builds", "Found older unfinished builds"]
    : ["Cancelling older unfinished builds", "Cancelled older unfinished builds"];
  const result = await createReporter().phase(
    open,
    done,
    async () => await createClient(url, token).projects.builds.cancelOlder(slug, input),
  );
  printResult(result, dryRun);
}

function printResult(result: CancelOlderResult, dryRun: boolean): void {
  if (result.count === 0) {
    printLine("No older unfinished builds to cancel");
    return;
  }
  printLine(`${dryRun ? "Would cancel" : "Cancelled"} ${result.count} build(s):`);
  for (const id of result.cancelled) {
    printLine(`  ${id}`);
  }
}
