#!/usr/bin/env node
// oxlint-disable no-console
/**
 * Weekly dependency audit (#47, `.github/workflows/audit.yml`). Audits the workspace lockfile and
 * each Storybook fixture, then compares the advisories with the tracked exceptions in
 * `scripts/audit-exceptions.json` (the reasons live in SECURITY.md, "Known advisories").
 *
 * Fails (exit 1) on: an advisory that is not an exception, an exception past its `reviewBy` date,
 * an exception file that is malformed or missing from SECURITY.md, and an audit that could not run.
 * An exception that no longer matches anything is reported as a notice, never a failure. It never
 * upgrades, writes or publishes anything, and prints only advisory ids, package names, versions and
 * advisory URLs (never an advisory body, a registry URL or a token).
 *
 * Workspace: `nub audit` reads only the root importer (182 of the lockfile's 1581 packages), so the
 * workspace is audited as `pnpm audit` over a copy of `nub.lock` (pnpm's lockfile format) and the
 * workspace manifests, in a scratch directory. Nothing in the repository is touched.
 * Fixtures: `pnpm audit` in each `fixtures/storybook-*` (independent pnpm installs).
 *
 * CLI: node scripts/audit-check.mjs [--today YYYY-MM-DD] [--target <name>]...
 * Writes a Markdown report to $GITHUB_STEP_SUMMARY when set, and `::error::` annotations.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const GHSA = /^GHSA(?:-[2-9cfghjmpqrvwx]{4}){3}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const FIXTURE_TARGETS = ["storybook-8", "storybook-9", "storybook-10"];
/** Every target the audit covers: the workspace lockfile and each Storybook fixture. */
export const TARGETS = ["workspace", ...FIXTURE_TARGETS];

/**
 * Read the advisories out of a `pnpm audit --json` document (npm audit format).
 *
 * @param {string} text The command's standard output.
 * @returns {{ id: string, severity: string, module: string, versions: string[], url: string }[]}
 */
export function parseAdvisories(text) {
  const report = JSON.parse(text);
  if (report === null || typeof report !== "object" || report.advisories === undefined) {
    throw new Error("the audit output has no `advisories` field");
  }
  return Object.values(report.advisories).map((advisory) => ({
    id: String(advisory.github_advisory_id ?? advisory.id),
    severity: String(advisory.severity),
    module: String(advisory.module_name),
    versions: (advisory.findings ?? []).map((finding) => String(finding.version)),
    url: String(advisory.url ?? ""),
  }));
}

/**
 * Check the exception list itself: shape, ids, dates, targets, and presence in SECURITY.md.
 *
 * @param {{ advisory?: string, target?: string, package?: string, reviewBy?: string, issue?: number }[]} exceptions
 * @param {string} securityText The text of SECURITY.md.
 * @returns {string[]} One message per problem.
 */
export function validateExceptions(exceptions, securityText) {
  return exceptions.flatMap((entry, index) => {
    const name = `exception ${index + 1} (${entry.advisory ?? "?"})`;
    const problems = [];
    if (!GHSA.test(entry.advisory ?? "")) problems.push("`advisory` must be a GHSA id");
    if (!TARGETS.includes(entry.target ?? ""))
      problems.push(`\`target\` must be one of ${TARGETS.join(", ")}`);
    if (!DATE.test(entry.reviewBy ?? "") || Number.isNaN(Date.parse(entry.reviewBy ?? ""))) {
      problems.push("`reviewBy` must be a YYYY-MM-DD date");
    }
    if (!Number.isInteger(entry.issue)) problems.push("`issue` must be an issue number");
    if (entry.advisory && !securityText.includes(entry.advisory)) {
      problems.push("is not listed in SECURITY.md, 'Known advisories'");
    }
    return problems.map((problem) => `${name}: ${problem}`);
  });
}

/**
 * Compare each target's advisories with the exceptions.
 *
 * @param {Record<string, ReturnType<typeof parseAdvisories>>} reports Advisories per target.
 * @param {{ advisory: string, target: string, package?: string, reviewBy: string, issue: number }[]} exceptions
 * @param {string} today YYYY-MM-DD.
 * @returns {{ unlisted: object[], expired: object[], accepted: object[], unused: object[] }}
 */
export function evaluate(reports, exceptions, today) {
  const result = { unlisted: [], expired: [], accepted: [], unused: [] };
  const used = new Set();
  const rows = Object.entries(reports).flatMap(([target, list]) =>
    list.map((advisory) => ({ target, ...advisory })),
  );
  for (const row of rows) {
    const found = exceptions.find(
      (entry) => entry.target === row.target && entry.advisory === row.id,
    );
    used.add(found);
    const bucket = bucketOf(found, today);
    result[bucket].push(found === undefined ? row : { ...row, exception: found });
  }
  result.unused = exceptions.filter((entry) => !used.has(entry));
  return result;
}

const bucketOf = (found, today) => {
  if (found === undefined) return "unlisted";
  return found.reviewBy < today ? "expired" : "accepted";
};

/**
 * Run an audit command and return its advisories. `pnpm audit` exits 1 when it finds any, so the
 * exit code is not the signal: output that is not an audit report is (a network or registry error).
 *
 * @param {string} cwd Where to run it.
 * @param {typeof spawnSync} [run] The process runner, replaced in tests.
 * @returns {ReturnType<typeof parseAdvisories>}
 */
export function runAudit(cwd, run = spawnSync) {
  const result = run("pnpm", ["audit", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 268_435_456,
  });
  if (result.error) throw new Error(`could not run pnpm audit: ${result.error.message}`);
  try {
    return parseAdvisories(result.stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unreadable output";
    throw new Error(`pnpm audit in ${cwd} gave no report (exit ${result.status}): ${reason}`, {
      cause: error,
    });
  }
}

/**
 * Copy `nub.lock` as `pnpm-lock.yaml` plus every workspace manifest into `into`, so `pnpm audit`
 * can read the whole workspace. The repository is only read.
 *
 * @param {string} root The repository root.
 * @param {string} into An empty scratch directory.
 */
export function stageWorkspace(root, into) {
  copyFileSync(join(root, "package.json"), join(into, "package.json"));
  copyFileSync(join(root, "nub.lock"), join(into, "pnpm-lock.yaml"));
  const groups = ["apps", "packages"];
  writeFileSync(
    join(into, "pnpm-workspace.yaml"),
    `packages:\n${groups.map((group) => `  - "${group}/*"\n`).join("")}`,
  );
  for (const group of groups) {
    for (const name of readdirSync(join(root, group))) {
      const manifest = join(root, group, name, "package.json");
      if (!existsSync(manifest)) continue;
      mkdirSync(join(into, group, name), { recursive: true });
      copyFileSync(manifest, join(into, group, name, "package.json"));
    }
  }
}

/**
 * Audit one target.
 *
 * @param {string} root The repository root.
 * @param {string} target One of {@link TARGETS}.
 * @returns {ReturnType<typeof parseAdvisories>}
 */
function auditTarget(root, target) {
  if (target !== "workspace") return runAudit(join(root, "fixtures", target));
  const scratch = mkdtempSync(join(root, ".tmp", "audit-"));
  try {
    stageWorkspace(root, scratch);
    return runAudit(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const line = (row) =>
  `${row.id} ${row.module} ${row.versions.join(", ")} (${row.severity}) in ${row.target}: ${row.url}`;

const tableRows = (items, note) =>
  items.map(
    (row) =>
      `| ${row.target} | [${row.id}](${row.url}) | ${row.module} ${row.versions.join(", ")} | ${row.severity} | ${note(row)} |`,
  );

/**
 * Render the verdict as Markdown and the failure messages.
 *
 * @param {ReturnType<typeof evaluate>} result
 * @param {string[]} problems Exception-file and audit-run problems.
 * @returns {{ markdown: string, failures: string[] }}
 */
export function render(result, problems) {
  const failures = [
    ...problems,
    ...result.unlisted.map(
      (row) =>
        `Unlisted advisory: ${line(row)}. Upgrade, or ask the owner to track it (SECURITY.md, #335).`,
    ),
    ...result.expired.map(
      (row) =>
        `Exception past its review date ${row.exception.reviewBy}: ${line(row)} (#${row.exception.issue}).`,
    ),
  ];
  const table = [
    ...tableRows(result.unlisted, () => "**unlisted: fails**"),
    ...tableRows(result.expired, (row) => `**expired ${row.exception.reviewBy}: fails**`),
    ...tableRows(
      result.accepted,
      (row) => `tracked, review by ${row.exception.reviewBy} (#${row.exception.issue})`,
    ),
  ];
  const unused = result.unused.map(
    (entry) =>
      `- Exception ${entry.advisory} (${entry.target}) matched nothing: remove it once it is confirmed fixed.`,
  );
  const head =
    failures.length === 0
      ? "## Dependency audit: passed"
      : `## Dependency audit: ${failures.length} failure(s)`;
  const markdown = [
    head,
    "",
    ...failures.map((failure) => `- ${failure}`),
    "",
    "| Target | Advisory | Package | Severity | Status |",
    "| --- | --- | --- | --- | --- |",
    ...table,
    "",
    ...unused,
    "",
  ].join("\n");
  return { markdown, failures };
}

/**
 * Collect every target's advisories; a target whose audit cannot run is a problem, not a crash.
 *
 * @param {string} root The repository root.
 * @param {string[]} targets Targets to audit.
 * @returns {{ reports: Record<string, ReturnType<typeof parseAdvisories>>, problems: string[] }}
 */
function collect(root, targets) {
  const reports = {};
  const problems = [];
  for (const target of targets) {
    try {
      reports[target] = auditTarget(root, target);
    } catch (error) {
      problems.push(
        `Audit of ${target} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { reports, problems };
}

function parseArgs(argv) {
  const targets = [];
  let today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--today") today = argv[(i += 1)];
    else if (argv[i] === "--target") targets.push(argv[(i += 1)]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return { today, targets: targets.length > 0 ? targets : TARGETS };
}

function loadInputs(root) {
  const { exceptions } = JSON.parse(
    readFileSync(join(root, "scripts", "audit-exceptions.json"), "utf8"),
  );
  return { exceptions, security: readFileSync(join(root, "SECURITY.md"), "utf8") };
}

function main() {
  const root = join(import.meta.dirname, "..");
  const { today, targets } = parseArgs(process.argv.slice(2));
  const { exceptions, security } = loadInputs(root);
  mkdirSync(join(root, ".tmp"), { recursive: true });
  const { reports, problems } = collect(root, targets);
  const invalid = validateExceptions(exceptions, security);
  const { markdown, failures } = render(evaluate(reports, exceptions, today), [
    ...invalid,
    ...problems,
  ]);
  publish(markdown, failures);
}

function publish(markdown, failures) {
  console.log(markdown);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, `${markdown}\n`);
  for (const failure of failures) console.log(`::error title=Dependency audit::${failure}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
