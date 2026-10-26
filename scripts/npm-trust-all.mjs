// oxlint-disable max-statements curly no-console no-inline-comments no-process-exit no-await-in-loop
/**
 * Configure npm trusted publishing (GitHub Actions, release.yml) for every
 * public workspace package, idempotently.
 *
 * Needs a fresh npm 2FA code, e.g.:
 *   npm_config_otp=$(op item get <npm-item> --otp) node scripts/npm-trust-all.mjs
 *
 * Usage:
 *   node scripts/npm-trust-all.mjs
 *   node scripts/npm-trust-all.mjs --package @storyshelf/notify-git
 *   node scripts/npm-trust-all.mjs --package @storyshelf/image --package @storyshelf/mcp
 *
 * With no `--package`, every public package is checked. Repeat the flag (or
 * pass bare package names) to limit the run to one or more packages.
 *
 * The registry's trust endpoint can answer a bare 400 with no message, so the
 * exit code of `npm trust github` is not trusted: state is always re-read with
 * `npm trust list`. Packages that still lack a config are printed with the
 * npmjs.com settings URL (Settings → Trusted Publisher → GitHub Actions) and
 * the script exits non-zero.
 */
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { getPublicPackageNames } from "./public-packages.mjs";

const REPOSITORY = "GuptaSiddhant/StoryShelf";
const WORKFLOW = "release.yml";
const PAUSE_MS = 2000;

function npm(args) {
  return execFileSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
}

// `npm trust list --json` prints one JSON object per config (not an array)
// when a package has several, so match objects rather than parsing the whole text.
const CONFIG_OBJECT_RE = /\{[^{}]*\}/gu;

function isTrusted(name) {
  try {
    const output = npm(["trust", "list", name, "--json"]);
    return (output.match(CONFIG_OBJECT_RE) ?? []).some((raw) => {
      const config = JSON.parse(raw);
      return config.repository === REPOSITORY && config.file === WORKFLOW;
    });
  } catch {
    return false;
  }
}

function createTrust(name) {
  try {
    npm([
      "trust",
      "github",
      name,
      "--repo",
      REPOSITORY,
      "--file",
      WORKFLOW,
      "--allow-publish",
      "--yes",
    ]);
  } catch (error) {
    // Re-checked below; the endpoint's status code is unreliable.
    const reason = String(error.stderr ?? error.message).match(/npm error code (?<code>\w+)/u)
      ?.groups?.["code"];
    if (reason === "E429") {
      console.error("npm rate-limited the trust endpoint (E429). Wait 15+ minutes and rerun.");
      process.exit(2);
    }
    console.log(`  npm trust exited with ${reason ?? "an error"}; verifying…`);
  }
}

function printHelp() {
  console.log(`Usage: node scripts/npm-trust-all.mjs [--package <name> ...]

With no --package, every public package is checked. Repeat --package (or pass
bare package names) to limit the run to one or more packages.`);
}

function parseArgs(argv) {
  const names = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--package") {
      const value = argv[index + 1];
      if (!value) throw new Error("--package expects a package name.");
      names.push(value);
      index += 1;
    } else if (arg.startsWith("--package=")) {
      names.push(arg.slice("--package=".length));
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option '${arg}'. Run with --help.`);
    } else {
      names.push(arg);
    }
  }
  return [...new Set(names)];
}

function selectPackages(requested) {
  const publicNames = getPublicPackageNames();
  if (requested.length === 0) return publicNames;
  const unknown = requested.filter((name) => !publicNames.includes(name));
  if (unknown.length > 0) {
    throw new Error(`not a public package: ${unknown.join(", ")}`);
  }
  return requested;
}

function packagesFromArgs() {
  try {
    return selectPackages(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const missing = [];
for (const name of packagesFromArgs()) {
  if (isTrusted(name)) {
    console.log(`✓ ${name} already trusted`);
    continue;
  }
  console.log(`→ ${name}: creating trust`);
  createTrust(name);
  await setTimeout(PAUSE_MS);
  if (isTrusted(name)) {
    console.log(`✓ ${name} trusted`);
  } else {
    missing.push(name);
  }
}

if (missing.length > 0) {
  console.error(`\n${missing.length} package(s) still need a trusted publisher:`);
  for (const name of missing) {
    console.error(`  https://www.npmjs.com/package/${name}/access`);
  }
  console.error(`Add GitHub Actions → ${REPOSITORY}, workflow ${WORKFLOW}, no environment.`);
  process.exit(1);
}
console.log("\nAll packages trusted.");
