// oxlint-disable no-console unicorn/no-process-exit
// Checks the AI-facing files `markdown-export.mjs` wrote into dist/ (run after `astro build`):
//   1. every page in the sitemap has an index.md;
//   2. every link in llms.txt resolves to a file in dist/;
//   3. each bundle (and llms-full.txt) stays under its size budget;
//   4. no MDX or JSX is left in any .md (a component tag, an import, a `:::` directive).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BUNDLES, CHARS_PER_TOKEN, FULL } from "./llms-config.mjs";

const DIST = "dist";
const SITE = (process.env.SITE_URL ?? "https://storyshelf.js.org").replace(/\/$/u, "");
const BASE = (process.env.BASE_PATH ?? "/").replace(/\/$/u, "");
// Pages that have no Markdown copy (generated references and the home page).
const NO_MARKDOWN = [`${BASE}/`, `${BASE}/api/`, `${BASE}/reference/`, `${BASE}/openapi/`];

const errors = [];
const fail = (message) => errors.push(message);

/** The path part of a site URL below the configured base, or `null` for another site. */
function localPath(url) {
  if (!url.startsWith(SITE)) return null;
  return decodeURIComponent(url.slice(SITE.length).split(/[#?]/u)[0]);
}

/** A file or directory of dist/ for a site path (`/guides/ci/` is its `index.html`). */
function resolves(path) {
  const stripped = BASE && path.startsWith(BASE) ? path.slice(BASE.length) : path;
  const file = join(DIST, stripped);
  if (!existsSync(file)) return false;
  return !statSync(file).isDirectory() || existsSync(join(file, "index.html"));
}

/** Every `<loc>` of the sitemap(s) as site paths. */
function sitemapPaths() {
  const names = readdirSync(DIST).filter((name) => /^sitemap-\d+\.xml$/u.test(name));
  return names.flatMap((name) =>
    [...readFileSync(join(DIST, name), "utf8").matchAll(/<loc>([^<]+)<\/loc>/gu)]
      .map((match) => localPath(match[1]))
      .filter((path) => path !== null),
  );
}

function checkSitemap() {
  const paths = sitemapPaths();
  if (paths.length === 0) fail("sitemap: no pages found in dist/sitemap-*.xml");
  for (const path of paths) {
    if (NO_MARKDOWN.includes(path) || /^\/(api|reference)\//u.test(path.slice(BASE.length))) {
      continue;
    }
    if (!existsSync(join(DIST, path.slice(BASE.length), "index.md"))) {
      fail(`sitemap: ${path} has no index.md`);
    }
  }
  return paths.length;
}

function checkLlmsLinks() {
  const text = readFileSync(join(DIST, "llms.txt"), "utf8");
  const links = [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/gu)].map((match) => match[1]);
  for (const link of links) {
    const path = localPath(link);
    if (path !== null && !resolves(path)) fail(`llms.txt: ${link} does not resolve in dist/`);
  }
  for (const { file } of [...BUNDLES, FULL]) {
    if (!text.includes(`${SITE}/${file}`)) fail(`llms.txt: no link to ${file}`);
  }
  return links.length;
}

function checkBudgets() {
  for (const { file, budget } of [...BUNDLES, FULL]) {
    const path = join(DIST, file);
    if (!existsSync(path)) {
      fail(`${file}: missing`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    const tokens = Math.ceil(text.length / CHARS_PER_TOKEN);
    if (tokens > budget) fail(`${file}: about ${tokens} tokens, over its budget of ${budget}`);
    if (!/^> Describes StoryShelf \S+ \(built from \S+ on \d{4}-\d{2}-\d{2}\)$/mu.test(text)) {
      fail(`${file}: no version stamp`);
    }
    console.log(`  ${file}: about ${tokens} of ${budget} tokens`);
  }
}

/** The Markdown outside fenced code blocks. */
function outsideFences(text) {
  const kept = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence === null && marker) fence = marker;
    else if (fence !== null && marker?.startsWith(fence)) fence = null;
    else if (fence === null) kept.push(line);
  }
  return kept.join("\n").replaceAll(/`[^`\n]*`/gu, "");
}

const MDX_LEFTOVERS = [
  [/<[A-Z][A-Za-z]*[\s/>]/u, "a JSX component tag"],
  [/^\s*import\s[^\n]*\sfrom\s/mu, "an import statement"],
  [/^\s*:::/mu, "a `:::` directive"],
];

/** Every .md under dist/. */
function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

function checkLeftovers() {
  const files = markdownFiles(DIST);
  for (const file of files) {
    const text = outsideFences(readFileSync(file, "utf8"));
    for (const [pattern, what] of MDX_LEFTOVERS) {
      if (pattern.test(text)) fail(`${file}: contains ${what}`);
    }
  }
  return files.length;
}

console.log("llms check:");
const pageCount = checkSitemap();
const linkCount = checkLlmsLinks();
checkBudgets();
const mdCount = checkLeftovers();
console.log(`  ${pageCount} sitemap pages, ${linkCount} llms.txt links, ${mdCount} .md files`);

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s):\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  process.exit(1);
}
console.log("llms check: ok");
