import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const distDir = "dist";
// Base path can be set via BASE_PATH env var (used by Astro --base option)
// In CI, this would be like "/storyshelf/" for GitHub Pages project sites
const basePath = process.env.BASE_PATH || "/";

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

function extractLinks(html, basePath) {
  const links = [];
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/g;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) {
      links.push({ href, basePath });
    }
  }
  return links;
}

function resolveLink(href, basePath) {
  // Strip the BASE_PATH prefix from href since dist/ doesn't have it
  let normalizedHref = href;
  if (basePath !== "/" && href.startsWith(basePath)) {
    normalizedHref = href.slice(basePath.length - 1); // keep leading /
  }
  if (normalizedHref.startsWith("/")) {
    return join(distDir, normalizedHref.slice(1));
  }
  return join(basePath, normalizedHref);
}

const htmlFiles = getHtmlFiles(distDir);
const pageMap = new Set();
for (const file of htmlFiles) {
  const rel = relative(distDir, file).replace(/\\/g, "/");
  pageMap.add("/" + rel.replace("/index.html", "").replace(".html", "") || "/");
}

let errors = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf-8");
  const basePath = join(process.cwd(), file).replace(/[^/]+$/, "");
  const links = extractLinks(html, basePath);

  for (const { href, basePath: _bp } of links) {
    const resolved = resolveLink(href, basePath);
    if (!statSync(resolved, { throwIfNoEntry: false })) {
      console.error(`BROKEN: ${file} -> ${href} (resolved: ${resolved})`);
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
