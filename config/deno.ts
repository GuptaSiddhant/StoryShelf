import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResolvedConfig } from "tsdown";

const INDEX_KEY = "index";
const DENO_JSON = "deno.json";
const SCHEMA_URL =
  "https://raw.githubusercontent.com/denoland/deno/refs/heads/main/cli/schemas/config-file.v1.json";
const NPM_SCHEME = "npm:";
const PUBLISH_INCLUDE = ["src", "README.md", "LICENSE"];
const PUBLISH_EXCLUDE = ["**/*.test.ts", "**/*.test.tsx", "**/test-helpers"];

function mapEntries(entry: Record<string, string>): Record<string, string> {
  const exports: Record<string, string> = {};
  for (const [key, source] of Object.entries(entry)) {
    const exportName = key === INDEX_KEY ? "." : key.startsWith("./") ? key : `./${key}`;
    const exportSource = source.startsWith("./") ? source : `./${source}`;
    exports[exportName] = exportSource;
  }
  return exports;
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function installedVersion(pkgRoot: string, name: string): string | null {
  const manifest = readJson(join(pkgRoot, "node_modules", name, "package.json"));
  const version = manifest?.["version"];
  return typeof version === "string" ? version : null;
}

function parseNpmSpecifier(value: string): { name: string; subpath: string } | null {
  if (!value.startsWith(NPM_SCHEME)) {
    return null;
  }
  const rest = value.slice(NPM_SCHEME.length);
  const at = rest.lastIndexOf("@");
  if (at < 1) {
    return null;
  }
  const name = rest.slice(0, at);
  const after = rest.slice(at + 1);
  const slash = after.indexOf("/");
  const subpath = slash < 0 ? "" : after.slice(slash);
  if (name.length === 0) {
    return null;
  }
  return { name, subpath };
}

function refreshImports(pkgRoot: string, deno: Record<string, unknown>): void {
  const imports = deno["imports"];
  if (!imports || typeof imports !== "object" || Array.isArray(imports)) {
    return;
  }
  for (const key of Object.keys(imports)) {
    const value = (imports as Record<string, unknown>)[key];
    if (typeof value !== "string") {
      continue;
    }
    const parsed = parseNpmSpecifier(value);
    if (!parsed) {
      continue;
    }
    const version = installedVersion(pkgRoot, parsed.name);
    if (version) {
      (imports as Record<string, unknown>)[key] =
        `${NPM_SCHEME}${parsed.name}@${version}${parsed.subpath}`;
    }
  }
}

/**
 * tsdown `onSuccess` hook: derive JSR `exports` from the resolved tsdown entry map
 * and write them to the package's `deno.json` for TypeScript-source publishing.
 *
 * Only `name`/`version`/`exports` are managed; every other key (notably an
 * `imports` map, whose pinned versions are refreshed from the installed
 * tree) is preserved. Creates the file with publish defaults when missing.
 */
export function generateDenoConfig(config: ResolvedConfig): void {
  const pkgRoot = config.pkg?.packageJsonPath ? dirname(config.pkg.packageJsonPath) : null;
  if (!pkgRoot) {
    return;
  }
  const pkg = readJson(join(pkgRoot, "package.json"));
  const name = pkg?.["name"] ?? config.pkg?.name;
  if (!pkg || typeof name !== "string" || name.length === 0) {
    return;
  }

  const denoPath = join(pkgRoot, DENO_JSON);
  const deno: Record<string, unknown> = readJson(denoPath) ?? {
    $schema: SCHEMA_URL,
    name,
    version: String(pkg["version"] ?? "0.0.0"),
    exports: {},
    publish: { include: PUBLISH_INCLUDE, exclude: PUBLISH_EXCLUDE },
  };
  deno["name"] = name;
  deno["version"] = String(pkg["version"] ?? "0.0.0");
  deno["exports"] = mapEntries(config.entry);
  refreshImports(pkgRoot, deno);
  writeFileSync(denoPath, `${JSON.stringify(deno, null, 2)}\n`);
}
