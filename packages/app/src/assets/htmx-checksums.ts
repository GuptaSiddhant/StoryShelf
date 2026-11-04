/**
 * The guard `scripts/embed-htmx.ts` applies to `htmx.sha256.json`, kept here so tests can reach it
 * (the script runs on import and writes fixed repository paths).
 */

/** What `htmx.sha256.json` holds. */
export interface RecordedChecksums {
  version: string;
  upstream: { package: string; file: string; sha256: string; bytes: number };
  embedded: { sha256: string; bytes: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const SHA256 = /^[0-9a-f]{64}$/u;

function isChecksum(value: unknown, withFile: boolean): boolean {
  return (
    isRecord(value) &&
    typeof value["sha256"] === "string" &&
    SHA256.test(value["sha256"]) &&
    typeof value["bytes"] === "number" &&
    (!withFile || (typeof value["package"] === "string" && typeof value["file"] === "string"))
  );
}

/**
 * The record in `text`, or `undefined` when there is none yet (no `text`).
 *
 * @throws When a record exists but is not valid JSON of the expected shape: a damaged record must
 *   stop the script, not read as "nothing recorded" and let changed bytes through.
 */
export function parseRecorded(text?: string): RecordedChecksums | undefined {
  if (text === undefined) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(text);
  if (
    !isRecord(parsed) ||
    typeof parsed["version"] !== "string" ||
    !isChecksum(parsed["upstream"], true) ||
    !isChecksum(parsed["embedded"], false)
  ) {
    throw new Error("htmx.sha256.json is not a valid checksum record; fix or delete it");
  }
  return parsed as unknown as RecordedChecksums;
}

/** Stop when this version was recorded with other bytes, unless the caller accepted the change. */
export function assertSameBytes(
  recorded: RecordedChecksums | undefined,
  version: string,
  upstreamSha: string,
  accepted: boolean,
): void {
  if (!recorded || recorded.version !== version || recorded.upstream.sha256 === upstreamSha) {
    return;
  }
  if (!accepted) {
    throw new Error(
      `htmx ${version} was recorded with sha256 ${recorded.upstream.sha256}, but this file is ` +
        `${upstreamSha}. The same version should be the same bytes: find out why before ` +
        `re-running with --accept-changed-checksum.`,
    );
  }
}
