import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const distDir = 'dist';

// GitHub Pages BASE_PATH (set by workflow, e.g., "/" or "/StoryShelf/")
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

// Check if href resolves to a file in dist/
// The href may have a base path prefix like /StoryShelf/ from Astro --base option
function checkLink(href) {
  let path = href;
  
  // Strip /StoryShelf/ prefix if present (GitHub Pages project site base path)
  // This handles hrefs like /StoryShelf/sitemap-index.xml
  if (path.startsWith('/StoryShelf/')) {
    path = path.slice('/StoryShelf/'.length);
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

const htmlFiles = getHtmlFiles(distDir);
let errors = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf-8');
  const links = extractLinks(html);
  
  for (const href of links) {
    if (!checkLink(href)) {
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
