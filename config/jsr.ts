import { readFileSync, writeFileSync } from "node:fs";
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

function mapEntryToJsrExports(entry: Record<string, string>): Record<string, string> {
  const exports: Record<string, string> = {};
  for (const [key, source] of Object.entries(entry)) {
    const exportName = key === INDEX_KEY ? "." : key.startsWith("./") ? key : `./${key}`;
    const exportSource = source.startsWith("./") ? source : `./${source}`;
    exports[exportName] = exportSource;
  }
  return exports;
}

function readPkg(pkgPath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
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

/**
 * tsdown `onSuccess` hook: derive JSR `exports` from the resolved tsdown entry map
 * and write a `jsr.json` (TypeScript-source publishing) next to the package.
 */
export function generateJsrConfig(config: ResolvedConfig): void {
  const pkgRoot = resolvePackageRoot(config);
  if (!pkgRoot) {
    return;
  }

  const pkg = readPkg(join(pkgRoot, "package.json"));
  const name = pkg.name ?? config.pkg?.name;
  if (typeof name !== "string" || name.length === 0) {
    return;
  }

  const jsr: JsrJson = {
    name,
    version: String(pkg.version ?? "0.0.0"),
    exports: mapEntryToJsrExports(config.entry),
    publish: {
      include: ["src", "README.md", "LICENSE"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/test-helpers"],
    },
  };

  if (typeof pkg.description === "string") {
    jsr.description = pkg.description;
  }
  if (typeof pkg.license === "string") {
    jsr.license = pkg.license;
  }

  writeFileSync(join(pkgRoot, "jsr.json"), `${JSON.stringify(jsr, null, 2)}\n`);
}