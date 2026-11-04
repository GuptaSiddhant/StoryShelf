// Lint and format-check every tracked file the commit hook checks (#604), so a file outside a
// package's lint globs (root `scripts/`, `packages/*/scripts`, `apps/*/scripts`, bench folders) cannot
// drift onto `main` and then fail the next person's commit. Same tools and file kinds as
// `.githooks/pre-commit`: `oxfmt --check` on code and JSON, `oxlint` on code.
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CODE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;
const JSON_FILE = /\.json$/u;
/** Independent projects that stand in for a customer's code; they are not linted as ours. */
const SKIPPED = ["fixtures/"];

/** The tracked files to format-check and to lint. */
export function selectFiles(tracked) {
  const kept = tracked.filter((file) => !SKIPPED.some((prefix) => file.startsWith(prefix)));
  return {
    format: kept.filter((file) => CODE.test(file) || JSON_FILE.test(file)),
    lint: kept.filter((file) => CODE.test(file)),
  };
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/** Run one tool over `files`; true when it passed. */
function run(tool, args, files) {
  const result = spawnSync(`node_modules/.bin/${tool}`, [...args, ...files], { stdio: "inherit" });
  return result.status === 0;
}

function main() {
  const { format, lint } = selectFiles(trackedFiles());
  const formatted = run("oxfmt", ["--check"], format);
  const linted = run("oxlint", [], lint);
  if (!formatted || !linted) {
    process.stderr.write(
      "error: tracked files fail the commit-hook checks. Run `nub run fmt` (or `node_modules/.bin/oxfmt <file>`) and fix the lint errors above.\n",
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
