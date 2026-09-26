// oxlint-disable no-console no-plusplus unicorn/no-process-exit
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const distDir = "dist";

// GitHub Pages BASE_PATH (set by workflow, e.g., "/" for root, "/StoryShelf/" for project site)
const basePath = process.env.BASE_PATH || "/";

// Get all HTML files in dist/
function getHtmlFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getHtmlFiles(full));
    } else if (entry.name.endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

// Extract internal href links (starting with /, ./, or ../)
function extractLinks(html) {
  const links = [];
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gu;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) {
      links.push(href);
    }
  }
  // Remove duplicates while preserving order
  return [...new Set(links)];
}

// Fragments (#...) and queries (?...) address content inside a page —
// they never affect whether the target file exists, so strip them.
function stripSuffix(href) {
  const index = href.search(/[?#]/u);
  return index === -1 ? href : href.slice(0, index);
}

// 1. Relative ./ and ../ hrefs: resolve against the containing file's
//    directory (exactly as a browser resolves page URL + href).
//    E.g. dist/guides/ci/index.html + ../packages/git-github/
//    -> dist/packages/git-github/
function isRelativeLink(target, filePath) {
  try {
    statSync(join(dirname(filePath), target));
    return true;
  } catch {
    return false;
  }
}

// Strip the BASE_PATH prefix (e.g. /StoryShelf/ for project sites)
// and resolve the remainder against dist/.
function stripBasePath(target) {
  let path = target;
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  if (basePath !== "/" && path.startsWith(normalizedBase)) {
    path = path.slice(normalizedBase.length);
  } else if (basePath !== "/" && (path === basePath || path === basePath.slice(0, -1))) {
    path = "";
  }
  if (path.startsWith("/")) {
    path = path.slice(1);
  }
  return path;
}

// 2. Absolute /hrefs: strip BASE_PATH prefix, check dist/ + remaining path.
//    Now path is relative like "sitemap-index.xml", "guides/deployment", or "".
function isDistPath(target) {
  const fullPath = join(distDir, stripBasePath(target));
  try {
    statSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

// Determine if a link from a given file is "internal" to the dist tree.
function isInternalLink(href, filePath) {
  const target = stripSuffix(href);
  if (target.startsWith("./") || target.startsWith("../")) {
    return isRelativeLink(target, filePath);
  }
  if (target.startsWith("/")) {
    return isDistPath(target);
  }
  return false;
}

const htmlFiles = getHtmlFiles(distDir);
let errors = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf-8");
  const links = extractLinks(html);

  for (const href of links) {
    if (!isInternalLink(href, file)) {
      console.error(`BROKEN: ${file} -> ${href}`);
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} broken internal link(s) found`);
  process.exit(1);
} else {
  console.log("All internal links OK");
}
