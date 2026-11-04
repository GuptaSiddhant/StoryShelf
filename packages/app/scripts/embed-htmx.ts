/**
 * Regenerates `src/assets/htmx.ts` from the published `htmx.min.js`, and records and checks its
 * checksums in `src/assets/htmx.sha256.json`:
 *
 *   nub packages/app/scripts/embed-htmx.ts <path to the unmodified htmx.min.js>
 *
 * Get the file from the npm package (`npm pack htmx.org@<version>`, then `package/dist/htmx.min.js`)
 * and pass it as published: the script formats it with oxfmt itself (the committed asset is the
 * formatted file), so the checksum recorded for the upstream file is the one the registry serves.
 *
 * - The SHA-256 of the upstream file is compared with the recorded one. The same version with
 *   different bytes stops the script (a re-published tarball, or a tampered file); pass
 *   `--accept-changed-checksum` only after finding out why. A new version records its own checksum:
 *   compare it with the tarball on the registry before committing.
 * - The SHA-256 of the embedded (formatted) source is recorded too. `htmx.test.ts` checks the
 *   committed asset against it, so an edit to `htmx.ts` by hand fails CI.
 *
 * The text is embedded verbatim in a `String.raw` template, so it must not contain a backtick or
 * `${`; the script refuses if it does.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** What `htmx.sha256.json` holds. */
interface RecordedChecksums {
  version: string;
  upstream: { package: string; file: string; sha256: string; bytes: number };
  embedded: { sha256: string; bytes: number };
}

/** The published file as read from disk. */
interface Upstream {
  bytes: Buffer;
  sha256: string;
  version: string;
}

const CHECKSUM_FILE = new URL("../src/assets/htmx.sha256.json", import.meta.url);
const ASSET_FILE = new URL("../src/assets/htmx.ts", import.meta.url);
const OXFMT = new URL("../../../node_modules/.bin/oxfmt", import.meta.url);

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function recordedChecksums(): Promise<RecordedChecksums | undefined> {
  try {
    return JSON.parse(await readFile(CHECKSUM_FILE, "utf8")) as RecordedChecksums;
  } catch {
    return undefined;
  }
}

/** Stop when this version was recorded with other bytes, unless the caller accepted the change. */
function assertSameBytes(
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

/** The file as the committed asset is: formatted by oxfmt. */
function formatted(source: string): string {
  return execFileSync(OXFMT.pathname, ["--stdin-filepath", "htmx.min.js"], {
    input: source,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function assetModule(version: string, source: string): string {
  return `/**
 * htmx ${version}, vendored as shipped in \`htmx.org@${version}/dist/htmx.min.js\` (formatted by oxfmt).
 *
 * Embedded as a string so it travels inside the compiled JavaScript: there is no file to find
 * at runtime, whether the app runs from source, from the library build or inside a bundle.
 * To upgrade, run \`nub packages/app/scripts/embed-htmx.ts <path to the new htmx.min.js>\`.
 */
export const htmxVersion = "${version}";

export const htmxSource = String.raw\`${source}\`;
`;
}

/** The published file as given on the command line, with its checksum and version. */
async function readUpstream(
  input: string,
): Promise<{ bytes: Buffer; sha256: string; version: string }> {
  const bytes = await readFile(resolve(input));
  const version = /version:\s*"(?<version>\d+\.\d+\.\d+)"/u.exec(bytes.toString("utf8"))?.groups?.[
    "version"
  ];
  if (!version) {
    throw new Error(`${input}: no htmx version string found; is this htmx.min.js?`);
  }
  return { bytes, sha256: sha256(bytes), version };
}

function checksumsOf(upstream: Upstream, source: string): RecordedChecksums {
  return {
    version: upstream.version,
    upstream: {
      package: `htmx.org@${upstream.version}`,
      file: "dist/htmx.min.js",
      sha256: upstream.sha256,
      bytes: upstream.bytes.length,
    },
    embedded: { sha256: sha256(source), bytes: Buffer.byteLength(source) },
  };
}

/** The formatted source, refused when it cannot sit inside a `String.raw` template. */
function embeddable(input: string, upstream: Upstream): string {
  const source = formatted(upstream.bytes.toString("utf8"));
  if (source.includes("`") || source.includes("${")) {
    throw new Error(`${input}: contains a backtick or "\${"; embed it as a JSON string instead`);
  }
  return source;
}

async function writeOutputs(upstream: Upstream, source: string): Promise<void> {
  await writeFile(ASSET_FILE, assetModule(upstream.version, source));
  await writeFile(CHECKSUM_FILE, `${JSON.stringify(checksumsOf(upstream, source), null, 2)}\n`);
  process.stdout.write(
    `wrote ${ASSET_FILE.pathname} (htmx ${upstream.version}, upstream sha256 ${upstream.sha256})\n`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = args.find((arg) => !arg.startsWith("--"));
  if (!input) {
    throw new Error("usage: embed-htmx.ts [--accept-changed-checksum] <path to htmx.min.js>");
  }
  const upstream = await readUpstream(input);
  const accepted = args.includes("--accept-changed-checksum");
  assertSameBytes(await recordedChecksums(), upstream.version, upstream.sha256, accepted);
  await writeOutputs(upstream, embeddable(input, upstream));
}

await main();
