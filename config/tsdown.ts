import { readFileSync } from "node:fs";
import type { UserConfig } from "tsdown";
import { generateJsrConfig } from "./jsr.ts";

const isWatchMode = process.argv.includes("--watch") || process.argv.includes("-w");

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function getBaseOptions(): Partial<UserConfig> {
  return {
    platform: "node" as const,
    sourcemap: true as const,
    target: "node24" as const,
    treeshake: true,
    unbundle: true,
    cjsDefault: false,
    deps: { neverBundle: true as const },
    shims: true,
    clean: !isWatchMode,
    onSuccess: generateJsrConfig,
    define: { __PKG_VERSION__: JSON.stringify(readVersion()) },
  };
}

export function libConfig(entry: UserConfig["entry"]): UserConfig {
  return {
    ...getBaseOptions(),
    dts: true,
    entry,
    exports: { devExports: "source" },
  };
}

export function cliConfig(entry: UserConfig["entry"]): UserConfig {
  return {
    ...getBaseOptions(),
    banner: { js: "#!/usr/bin/env node" },
    dts: false,
    entry,
    fixedExtension: false,
  };
}
