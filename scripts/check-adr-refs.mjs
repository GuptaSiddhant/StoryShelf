#!/usr/bin/env node
/**
 * Check ADR numbering and references.
 *
 * Policy (docs/adr/README.md): current ADRs are 0001-0018, archived ADRs are
 * 0001-0036, and new ADRs start at 0037. A bare `ADR NNNN` means a current
 * ADR; an archived decision must say `archived ADR NNNN` (or link its file).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const adrDir = join(root, "docs", "adr");
const archiveDir = join(adrDir, "archive");
const CURRENT_MAX = 18;
const NEW_ADR_START = 37;
const MAX_ADR_LINES = 320;
const HISTORICAL = new Set(["CHANGELOG.md", "apps/website/src/content/docs/changelog.md"]);
const TEXT_EXTENSIONS = /\.(?:md|mdx|ts|tsx|js|mjs|json|ya?ml)$/u;
const ADR_MENTION = /\bADR (?<number>\d{4})\b/gu;
const ADR_LINK = /(?:\.\/|docs\/)?adr\/(?<number>\d{4})-(?<name>[^)\s`]+)/gu;

const errors = [];
const current = adrFiles(adrDir);
const archived = adrFiles(archiveDir);

function adrFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .filter((entry) => entry.name !== "README.md")
    .map((entry) => {
      const path = join(dir, entry.name);
      const match = /^(?<number>\d{4})-/u.exec(entry.name);
      return { path, name: entry.name, number: match ? Number(match.groups?.number) : undefined };
    });
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function checkCurrentAdrs() {
  const numbers = current.map((file) => file.number).filter((n) => n !== undefined);
  checkMissingNumbers(numbers);
  checkFrozenRange(numbers);
  checkAdrSizes();
}

function checkMissingNumbers(numbers) {
  for (let number = 1; number <= CURRENT_MAX; number += 1) {
    if (!numbers.includes(number)) {
      errors.push(`docs/adr: missing current ADR ${String(number).padStart(4, "0")}`);
    }
  }
}

function checkFrozenRange(numbers) {
  for (const number of numbers) {
    if (number > CURRENT_MAX) {
      errors.push(
        `docs/adr: current ADR ${String(number).padStart(4, "0")} exceeds the frozen range (new ADRs start at ${NEW_ADR_START})`,
      );
    }
  }
}

function checkAdrSizes() {
  for (const file of current) {
    const lines = readFileSync(file.path, "utf8").split("\n").length;
    if (lines > MAX_ADR_LINES) {
      errors.push(
        `docs/adr/${file.name}: ${lines} lines (max ${MAX_ADR_LINES}); move implementation detail to docs/architecture.md`,
      );
    }
  }
}

function checkReadmeTable() {
  const readme = readFileSync(join(adrDir, "README.md"), "utf8");
  for (const file of current) {
    if (file.number === undefined) {
      continue;
    }
    const number = String(file.number).padStart(4, "0");
    if (!new RegExp(`\\| ${number} \\|`, "u").test(readme)) {
      errors.push(`docs/adr/README.md: table does not list ADR ${number}`);
    }
  }
}

function checkReferences() {
  const allNumbers = new Set([...current, ...archived].map((file) => file.number));
  for (const path of trackedFiles()) {
    if (shouldSkip(path)) {
      continue;
    }
    checkFile(path, allNumbers);
  }
}

function shouldSkip(path) {
  return (
    !TEXT_EXTENSIONS.test(path) ||
    path.includes("node_modules/") ||
    path.startsWith("docs/adr/archive/") ||
    HISTORICAL.has(path)
  );
}

function checkFile(path, allNumbers) {
  const lines = readFileSync(join(root, path), "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    const location = `${path}:${index + 1}`;
    checkMentions(location, line, allNumbers);
    checkLinks(location, line);
  }
}

function checkMentions(location, line, allNumbers) {
  for (const match of line.matchAll(ADR_MENTION)) {
    const number = Number(match.groups?.number);
    const archivedRef = /\barchived\b|\bSupersedes\b/u.test(line);
    if (number > CURRENT_MAX && number < NEW_ADR_START && !archivedRef) {
      errors.push(
        `${location}: archived ADR ${match.groups?.number} must be written "archived ADR ${match.groups?.number}"`,
      );
    }
    if (number >= NEW_ADR_START && !allNumbers.has(number)) {
      errors.push(`${location}: ADR ${match.groups?.number} does not exist`);
    }
  }
}

function checkLinks(location, line) {
  for (const match of line.matchAll(ADR_LINK)) {
    const file = `${match.groups?.number}-${match.groups?.name}`;
    if (!existsSync(join(adrDir, file)) && !existsSync(join(archiveDir, file))) {
      errors.push(`${location}: missing ADR file docs/adr/${file}`);
    }
  }
}

function reportErrors() {
  process.stderr.write(`ADR check failed (${errors.length}):\n`);
  for (const error of errors) {
    process.stderr.write(`  ${error}\n`);
  }
}

checkCurrentAdrs();
checkReadmeTable();
checkReferences();

if (errors.length > 0) {
  reportErrors();
  process.exitCode = 1;
} else {
  process.stdout.write(
    `ADR check passed: ${current.length} current ADRs, ${archived.length} archived, references explicit.\n`,
  );
}
