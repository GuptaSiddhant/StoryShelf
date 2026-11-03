#!/usr/bin/env node
// oxlint-disable curly no-console
/**
 * Write a changeset (ADR 0043): `nub run changeset <patch|minor|major> [--package <name>…] [--message "<text>"]`.
 *
 * Creates `.changeset/<three-random-words>.md` in the format `version-packages.mjs` reads. With no
 * `--package` it names every published package (they share one version, so the choice only decides
 * the bump size). With no `--message` the file holds a placeholder that CI rejects until it is
 * replaced by the CHANGELOG entry. There is no prompt.
 */
import { randomInt } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUMPS, changesetName, renderChangeset } from "./changeset-lib.mjs";

const root = join(import.meta.dirname, "..");
const changesetDir = join(root, ".changeset");
const packagesDir = join(root, "packages");

const USAGE =
  'Usage: nub run changeset <patch|minor|major> [--package <name>…] [--message "<text>"]';

function fail(message) {
  console.error(`[changeset:error] ${message}\n${USAGE}`);
  process.exit(1);
}

/** Names of the published packages. */
function publishedNames() {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(readFileSync(join(packagesDir, entry.name, "package.json"), "utf8")))
    .filter((pkg) => !pkg.private)
    .map((pkg) => pkg.name);
}

const VALUE_FLAGS = new Set(["--package", "--message"]);

/** Record the value of a `--package` or `--message` flag. */
function setFlag(parsed, flag, value) {
  if (value === undefined) {
    fail(`${flag} needs a value`);
  }
  if (flag === "--package") {
    parsed.packages.push(value);
  } else {
    parsed.message = value;
  }
}

/** Split the arguments into the bump, the `--package` values and the `--message`. */
function parse(args) {
  const parsed = { bump: undefined, packages: [], message: undefined };
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    if (VALUE_FLAGS.has(arg)) {
      at += 1;
      setFlag(parsed, arg, args[at]);
    } else if (arg.startsWith("-") || parsed.bump !== undefined) {
      fail(`unexpected argument ${arg}`);
    } else {
      parsed.bump = arg;
    }
  }
  return parsed;
}

const { bump, packages, message } = parse(process.argv.slice(2));
if (bump === undefined || !BUMPS.includes(bump)) {
  fail(`the bump is one of ${BUMPS.join(", ")}`);
}
const known = publishedNames();
const unknown = packages.filter((name) => !known.includes(name));
if (unknown.length > 0) {
  fail(`unknown package ${unknown.join(", ")} (known: ${known.toSorted().join(", ")})`);
}
const name = changesetName(randomInt, (candidate) =>
  existsSync(join(changesetDir, `${candidate}.md`)),
);
const file = join(changesetDir, `${name}.md`);
writeFileSync(
  file,
  renderChangeset({ packages: packages.length > 0 ? packages : known.toSorted(), bump, message }),
);
console.log(`.changeset/${name}.md`);
