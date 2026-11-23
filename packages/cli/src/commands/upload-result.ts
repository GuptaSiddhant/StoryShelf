import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

/** The one JSON object `storyshelf upload --json` prints on stdout. */
export interface UploadResult {
  /** The build id; null when no build was made (`--dry-run`, or a branch skipped by config). */
  buildId: string | null;
  /** The build page, as the server returned it; null when the server gave none (or no build). */
  url: string | null;
  /** `created`; `skipped` when the commit was recorded as a skipped build or the config skips the branch; `dry-run`. */
  status: "created" | "skipped" | "dry-run";
  /** True when no Storybook was uploaded because nothing needed it (`status` is `skipped`). */
  skipped: boolean;
  /** With `--wait`: how the build ended (`approved`, `needs-review`, `rejected`, `failed`, `cancelled`, `timeout`, `interrupted`). */
  verdict?: string;
  /** With `--wait`: the exit code the command ends with. */
  exitCode?: number;
}

/** Print the result as one JSON line on stdout. */
export function printJsonResult(result: UploadResult): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

/**
 * Append `build-id` and `build-url` to the `GITHUB_OUTPUT` file, using the heredoc form so a value
 * can never inject another output. Does nothing when `GITHUB_OUTPUT` is unset.
 */
export function writeGithubOutputs(
  result: Pick<UploadResult, "buildId" | "url">,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const file = env["GITHUB_OUTPUT"];
  if (file === undefined || file === "" || result.buildId === null) return;
  const entries: [string, string][] = [["build-id", result.buildId]];
  if (result.url !== null) entries.push(["build-url", result.url]);
  appendFileSync(file, entries.map(([name, value]) => githubOutputEntry(name, value)).join(""));
}

/** One `name<<delimiter` block; the delimiter is random so no value can contain it. */
function githubOutputEntry(name: string, value: string): string {
  const delimiter = `ghadelimiter_${randomUUID()}`;
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}
