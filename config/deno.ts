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
const SHORT_STRING_ARRAY_RE = /\[(\s*"[^"\n]*",?)+\s*\]/gu;
const MAX_SINGLE_LINE_ARRAY = 80;

function compactShortArrays(json: string): string {
  return json.replace(SHORT_STRING_ARRAY_RE, (match) => {
    const items = match.match(/"[^"\n]*"/gu) ?? [];
    const single = `[${items.join(", ")}]`;
    return single.length <= MAX_SINGLE_LINE_ARRAY ? single : match;
  });
}

function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
  writeFileSync(filePath, `${compactShortArrays(JSON.stringify(value, null, 2))}\n`);
}

function mapEntries(entry: Record<string, string>): Record<string, string> {
  const exports: Record<string, string> = {};
  for (const [key, source] of Object.entries(entry)) {
    const exportName = key === INDEX_KEY ? "." : key.startsWith("./") ? key : `./${key}`;
    const exportSource = source.startsWith("./") ? source : `./${source}`;
    exports[exportName] = exportSource;
  }
  return exports;
}

function readPackageManifest(pkgRoot: string): {
  pkg: Record<string, unknown>;
  name: string;
} | null {
  const pkg = readJson(join(pkgRoot, "package.json"));
  const name = pkg?.["name"];
  if (!pkg || typeof name !== "string" || name.length === 0) {
    return null;
  }
  if (pkg["jsr"] === false) {
    return null;
  }
  return { pkg, name };
}

function loadDenoManifest(
  denoPath: string,
  name: string,
  version: string,
): Record<string, unknown> {
  const deno: Record<string, unknown> = readJson(denoPath) ?? {
    $schema: SCHEMA_URL,
    name,
    version,
    exports: {},
    publish: { include: PUBLISH_INCLUDE, exclude: PUBLISH_EXCLUDE },
  };
  deno["name"] = name;
  deno["version"] = version;
  return deno;
}

function writeDenoManifest(
  pkgRoot: string,
  denoPath: string,
  deno: Record<string, unknown>,
  entry: Record<string, string>,
): void {
  deno["exports"] = mapEntries(entry);
  refreshImports(pkgRoot, deno);
  writeJsonFile(denoPath, deno);
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function installedVersion(pkgRoot: string, name: string): string | null {
  const local = readJson(join(pkgRoot, "node_modules", name, "package.json"));
  const localVersion = local?.["version"];
  if (typeof localVersion === "string") {
    return localVersion;
  }
  // Fall back to the workspace root (public-hoisted deps like hono live
  // there under the isolated linker, so per-package pins would go stale).
  const rootVersion = readJson(join(pkgRoot, "..", "..", "node_modules", name, "package.json"))?.[
    "version"
  ];
  return typeof rootVersion === "string" ? rootVersion : null;
}

function splitSpecifierName(rest: string): { name: string; after: string } | null {
  const at = rest.lastIndexOf("@");
  if (at < 1) {
    return null;
  }
  const name = rest.slice(0, at);
  if (name.length === 0) {
    return null;
  }
  return { name, after: rest.slice(at + 1) };
}

function parseNpmSpecifier(value: string): { name: string; subpath: string } | null {
  if (!value.startsWith(NPM_SCHEME)) {
    return null;
  }
  const split = splitSpecifierName(value.slice(NPM_SCHEME.length));
  if (!split) {
    return null;
  }
  const slash = split.after.indexOf("/");
  const subpath = slash < 0 ? "" : split.after.slice(slash);
  return { name: split.name, subpath };
}

function refreshImport(pkgRoot: string, imports: Record<string, unknown>, key: string): void {
  const value = imports[key];
  if (typeof value !== "string") {
    return;
  }
  const parsed = parseNpmSpecifier(value);
  if (!parsed) {
    return;
  }
  const version = installedVersion(pkgRoot, parsed.name);
  if (version) {
    imports[key] = `${NPM_SCHEME}${parsed.name}@${version}${parsed.subpath}`;
  }
}

function refreshImports(pkgRoot: string, deno: Record<string, unknown>): void {
  const imports = deno["imports"];
  if (!imports || typeof imports !== "object" || Array.isArray(imports)) {
    return;
  }
  for (const key of Object.keys(imports)) {
    refreshImport(pkgRoot, imports as Record<string, unknown>, key);
  }
}

/**
 * tsdown `onSuccess` hook: derive JSR `exports` from the resolved tsdown entry map
 * and write them to the package's `deno.json` for TypeScript-source publishing.
 *
 * Only `name`/`version`/`exports` are managed; every other key (notably an
 * `imports` map, whose pinned versions are refreshed from the installed
 * tree) is preserved. Creates the file with publish defaults when missing.
 *
 * Packages opted out of JSR (`"jsr": false` in package.json) are skipped
 * entirely — no file is created or updated for them.
 */
export function generateDenoConfig(config: ResolvedConfig): void {
  const pkgRoot = config.pkg?.packageJsonPath ? dirname(config.pkg.packageJsonPath) : null;
  if (!pkgRoot) {
    return;
  }
  const manifest = readPackageManifest(pkgRoot);
  if (!manifest) {
    return;
  }

  const denoPath = join(pkgRoot, DENO_JSON);
  const deno = loadDenoManifest(
    denoPath,
    manifest.name,
    String(manifest.pkg["version"] ?? "0.0.0"),
  );
  writeDenoManifest(pkgRoot, denoPath, deno, config.entry);
}
