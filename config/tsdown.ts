import { readFileSync } from "node:fs";
import type { Plugin } from "rolldown";
import type { UserConfig } from "tsdown";
import { generateDenoConfig } from "./deno.ts";

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

// Defines replace bare identifiers only, so a `globalThis.__PKG_VERSION__` (or
// `globalThis["__PKG_VERSION__"]`) read ships unreplaced and always falls back.
const MEMBER_VERSION_READ = /(?:\.\s*|\[\s*["'`])__PKG_VERSION__/u;

/**
 * Fails the build on a member read of `__PKG_VERSION__`. Read it as a bare identifier behind a
 * `typeof` guard instead: `typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0"`.
 */
export function pkgVersionGuard(): Plugin {
  return {
    name: "storyshelf:pkg-version-guard",
    transform: {
      filter: { id: { include: /\/src\/.*\.tsx?$/u } },
      handler(code, id) {
        if (MEMBER_VERSION_READ.test(code)) {
          this.error(
            `${id}: read __PKG_VERSION__ as a bare identifier (typeof guard), not a member of globalThis`,
          );
        }
        return null;
      },
    },
  };
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
    onSuccess: generateDenoConfig,
    define: { __PKG_VERSION__: JSON.stringify(readVersion()) },
    plugins: [pkgVersionGuard()],
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
    // CLI binaries ship no source maps: the tarball stays small and no
    // source is exposed beyond the bundled output.
    sourcemap: false as const,
  };
}
