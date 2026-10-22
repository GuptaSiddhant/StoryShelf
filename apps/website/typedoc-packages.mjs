// TypeScript API reference: one starlight-typedoc instance per package, generated from the
// package's public `exports` map (the frozen import surface), never from internal modules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";
import { MAIN_MODULE } from "./plugins/typedoc-main-module.mjs";

const mainModulePlugin = join(import.meta.dirname, "plugins", "typedoc-main-module.mjs");
const root = join(import.meta.dirname, "..", "..");

/** Packages documented so far. Add a slug here once its doc comments are worth publishing. */
const SLUGS = ["core", "app"];

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

/** The `source` file of every public export, relative to the repo root. */
function entryPointsOf(slug) {
  const dir = join("packages", slug);
  const { exports } = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  return Object.entries(exports)
    .filter(([subpath, target]) => !SKIPPED.has(subpath) && typeof target.source === "string")
    .map(([, target]) => join(root, dir, target.source));
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
      sidebar: { label: `@storyshelf/${slug}`, collapsed: true },
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

/** One sidebar group wrapping every package's generated pages (shown on /reference/** only). */
export const typeDocSidebarGroup = {
  label: "TypeScript reference",
  items: instances.map((i) => i.sidebarGroup),
};
