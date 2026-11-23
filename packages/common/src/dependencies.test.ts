/**
 * `common` is the package the light packages install instead of core (#1334): its only runtime
 * dependency is `@opentelemetry/api`, and its source imports nothing but Node built-ins, that one
 * package and itself. A new import elsewhere fails here, before it reaches an installer.
 */
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;
const IMPORT = /\b(?:from|import)\s*\(?\s*["'](?<specifier>[^"']+)["']/gu;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/u.test(entry.name) && !/\.test\.ts$|span-recorder|test-setup/u.test(entry.name)
      ? [path]
      : [];
  });
}

function allowed(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("node:")) {
    return true;
  }
  return specifier === "@opentelemetry/api" || builtinModules.includes(specifier);
}

describe("@storyshelf/common dependencies", () => {
  it("declares @opentelemetry/api as its only runtime dependency", () => {
    const manifest = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["@opentelemetry/api"]);
    expect(manifest.peerDependencies).toBeUndefined();
  });

  it("imports only Node built-ins, @opentelemetry/api and itself", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(15);
    const offenders = files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(IMPORT)]
        .map((match) => match.groups?.["specifier"] ?? "")
        .filter((specifier) => !allowed(specifier))
        .map((specifier) => `${file.slice(SRC.length + 1)}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});
