// TypeScript API reference: one starlight-typedoc instance per package, generated from the
// package's public `exports` map (the frozen import surface), never from internal modules.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";
import { MAIN_MODULE } from "./plugins/typedoc-main-module.mjs";

const mainModulePlugin = join(import.meta.dirname, "plugins", "typedoc-main-module.mjs");
const root = join(import.meta.dirname, "..", "..");

/** Packages documented so far. Add a slug here once its doc comments are worth publishing. */
const SLUGS = [
  "core",
  "app",
  "affected",
  "image",
  "observability",
  "auth",
  "ai",
  "mcp",
  "db-sqlite",
  "db-postgres",
  "db-mysql",
  "storage-local",
  "storage-s3",
  "storage-azure",
  "storage-gcs",
  "runner-playwright",
  "runner-puppeteer",
  "design-figma",
  "notify-chat",
  "notify-email",
  "notify-git",
];

/**
 * Subpaths that are not StoryShelf API: the manifest, test-only helpers and the Drizzle
 * re-exports (`./orm*`), which are third-party API and take TypeDoc from 3 s to 90 s and 2 GB.
 */
const SKIPPED = new Set([
  "./package.json",
  "./test-helpers",
  "./orm",
  "./orm/pg-core",
  "./orm/sqlite-core",
]);

/** The source file of an export: its `source` condition, else `./dist/x.js` -> `./src/x.ts` when that exists. */
function sourceOf(dir, target) {
  if (typeof target === "object" && typeof target.source === "string") return target.source;
  const file =
    typeof target === "string"
      ? target.replace(/^\.\/dist\/(?<name>.+)\.js$/u, "./src/$<name>.ts")
      : "";
  return file.startsWith("./src/") && existsSync(join(root, dir, file)) ? file : undefined;
}

/** The source file of every public export, as absolute paths. */
function entryPointsOf(slug) {
  const dir = join("packages", slug);
  const { exports } = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  const entries = Object.entries(exports)
    .filter(([subpath]) => !SKIPPED.has(subpath))
    .map(([, target]) => sourceOf(dir, target))
    .filter((file) => file !== undefined)
    .map((file) => join(root, dir, file));
  if (entries.length === 0) throw new Error(`typedoc-packages: no source entry points for ${slug}`);
  return entries;
}

const instances = SLUGS.map((slug) => {
  const [plugin, sidebarGroup] = createStarlightTypeDocPlugin();
  return {
    slug,
    sidebarGroup,
    plugin: plugin({
      entryPoints: entryPointsOf(slug),
      tsconfig: join(root, "packages", slug, "tsconfig.json"),
      output: `reference/${slug}`,
      sidebar: { label: "API", collapsed: true },
      typeDoc: {
        skipErrorChecking: true,
        plugin: [mainModulePlugin],
        entryFileName: "index",
        entryModule: MAIN_MODULE,
        modulesFileName: "modules",
      },
    }),
  };
});

/** Plugins to register, in `starlight({ plugins })`. */
export const typeDocPlugins = instances.map((i) => i.plugin);

/** The generated "API" sidebar group of each documented package, by slug. */
export const typeDocGroups = new Map(instances.map((i) => [i.slug, i.sidebarGroup]));
