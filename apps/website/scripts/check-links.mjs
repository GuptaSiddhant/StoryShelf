import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const distDir = 'dist';

// GitHub Pages BASE_PATH (set by workflow, e.g., "/" for root, "/StoryShelf/" for project site)
const basePath = process.env.BASE_PATH || '/';

// Get all HTML files in dist/
function getHtmlFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getHtmlFiles(full));
    } else if (entry.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

// Extract internal href links (starting with /, ./, or ../)
function extractLinks(html) {
  const links = [];
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/g;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
      links.push(href);
    }
  }
  // Remove duplicates while preserving order
  return [...new Set(links)];
}

// Determine if a link from a given file is "internal" to the dist tree
// Rules:
// 1. Relative ./ and ../ hrefs: resolve against the containing file's
//    directory (exactly as a browser resolves page URL + href), then check
//    existence. E.g. dist/guides/ci/index.html + ../packages/git-github/
//    -> dist/packages/git-github/
// 2. Absolute /hrefs: strip BASE_PATH prefix, check dist/ + remaining path
function isInternalLink(href, filePath) {
  // 1. Relative hrefs: resolve against the containing file's directory
  if (href.startsWith('./') || href.startsWith('../')) {
    try {
      statSync(join(dirname(filePath), href));
      return true;
    } catch {
      return false;
    }
  }

  // 2. Absolute hrefs: strip BASE_PATH prefix, check dist/ + remaining path
  if (href.startsWith('/')) {
    let path = href;

    // Strip BASE_PATH prefix if present (e.g. /StoryShelf/ for project site)
    const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
    if (basePath !== '/' && path.startsWith(normalizedBase)) {
      path = path.slice(normalizedBase.length);
    } else if (basePath !== '/' && (path === basePath || path === basePath.slice(0, -1))) {
      path = '';
    }
    
    // Strip any remaining leading /
    if (path.startsWith('/')) {
      path = path.slice(1);
    }
    
    // Now path is relative like "sitemap-index.xml", "guides/deployment", or ""
    // Join with distDir and check existence
    const fullPath = join(distDir, path);
    try {
      statSync(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

const htmlFiles = getHtmlFiles(distDir);
let errors = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf-8');
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
  console.log('All internal links OK');
}
