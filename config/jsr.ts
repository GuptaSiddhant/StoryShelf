import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResolvedConfig } from "tsdown";

interface JsrJson {
  name: string;
  version: string;
  description?: string;
  license?: string;
  exports: Record<string, string>;
  publish: {
    include: string[];
    exclude: string[];
  };
}

const INDEX_KEY = "index";
const JSR_JSON = "jsr.json";
const DENO_JSON = "deno.json";

function mapEntryToJsrExports(entry: Record<string, string>): Record<string, string> {
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

function writeJson(filePath: string, value: Record<string, unknown>): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolvePackageRoot(config: ResolvedConfig): string | null {
  if (config.pkg?.packageJsonPath) {
    return dirname(config.pkg.packageJsonPath);
  }
  const cwdPkg = join(process.cwd(), "package.json");
  try {
    readFileSync(cwdPkg, "utf8");
    return process.cwd();
  } catch {
    return null;
  }
}

function writeJsrJson(
  pkgRoot: string,
  pkg: Record<string, unknown>,
  name: string,
  version: string,
  exports: Record<string, string>,
): void {
  const jsr: Record<string, unknown> = {
    name,
    version,
    exports,
    publish: {
      include: ["src", "README.md", "LICENSE"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/test-helpers"],
    },
  };
  if (typeof pkg["description"] === "string") {
    jsr["description"] = pkg["description"];
  }
  if (typeof pkg["license"] === "string") {
    jsr["license"] = pkg["license"];
  }
  writeJson(join(pkgRoot, JSR_JSON), jsr);
}

function updateDenoJson(
  denoPath: string,
  name: string,
  version: string,
  exports: Record<string, string>,
): void {
  const deno = readJson(denoPath);
  if (!deno) {
    return;
  }
  deno["name"] = name;
  deno["version"] = version;
  deno["exports"] = exports;
  writeJson(denoPath, deno);
}

/**
 * tsdown `onSuccess` hook: derive JSR `exports` from the resolved tsdown entry map
 * and write them to the package's JSR config for TypeScript-source publishing.
 *
 * Prefers `deno.json` when present (core: carries an `imports` map so the JSX
 * runtime resolves to an absolute specifier — see honojs/hono#3219) and updates
 * its name/version/exports in place, preserving all other keys. Otherwise
 * writes `jsr.json`.
 */
export function generateJsrConfig(config: ResolvedConfig): void {
  const pkgRoot = resolvePackageRoot(config);
  if (!pkgRoot) {
    return;
  }

  const pkg = readJson(join(pkgRoot, "package.json"));
  const name = pkg?.["name"] ?? config.pkg?.name;
  if (!pkg || typeof name !== "string" || name.length === 0) {
    return;
  }
  const version = String(pkg["version"] ?? "0.0.0");
  const exports = mapEntryToJsrExports(config.entry);

  const denoPath = join(pkgRoot, DENO_JSON);
  if (existsSync(denoPath)) {
    updateDenoJson(denoPath, name, version, exports);
    return;
  }
  writeJsrJson(pkgRoot, pkg, name, version, exports);
}
