// `<Readme heading="Quick start" />` in a package page (`src/content/docs/packages/<slug>.mdx`)
// is replaced by that section of `packages/<slug>/README.md`, so examples are written once and
// stay identical on npm, GitHub and the website. A missing heading fails the build.
import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const REPO_BLOB = "https://github.com/GuptaSiddhant/StoryShelf/blob/main";
const SITE = "https://storyshelf.js.org";
const PACKAGES_DIR = join(import.meta.dirname, "..", "..", "..", "packages");
const parser = unified().use(remarkParse).use(remarkGfm);

function textOf(node) {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map((child) => textOf(child)).join("");
}

/** The nodes under `heading`, up to the next heading of the same or a higher level. */
function sectionOf(tree, heading, where) {
  const start = tree.children.findIndex((n) => n.type === "heading" && textOf(n) === heading);
  if (start === -1) throw new Error(`Section "${heading}" not found in ${where}`);
  const { depth } = tree.children[start];
  const rest = tree.children.slice(start + 1);
  const end = rest.findIndex((n) => n.type === "heading" && n.depth <= depth);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Absolute site links become site paths (so the link validator sees them); relative ones point at GitHub. */
function rewriteLink(url, slug) {
  if (url.startsWith(SITE)) return url.slice(SITE.length) || "/";
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(url)) return url;
  return `${REPO_BLOB}/packages/${slug}/${url}`;
}

/** Drop README positions (they point into another file) and raw HTML, which MDX cannot render. */
function clean(nodes, slug) {
  return nodes
    .filter((n) => n.type !== "html")
    .map((node) => {
      const { position: _position, ...rest } = node;
      if (rest.type === "link" || rest.type === "definition")
        rest.url = rewriteLink(rest.url, slug);
      if (rest.children) rest.children = clean(rest.children, slug);
      return rest;
    });
}

const isReadme = (n) => n.type === "mdxJsxFlowElement" && n.name === "Readme";

function expand(node, tree, slug, where) {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (!isReadme(child)) {
      expand(child, tree, slug, where);
      return [child];
    }
    const heading = child.attributes?.find((a) => a.name === "heading")?.value;
    if (typeof heading !== "string")
      throw new Error(`<Readme> needs a heading="..." attribute (${where})`);
    return clean(sectionOf(tree, heading, where), slug);
  });
}

export default function remarkReadmeSection() {
  return (tree, file) => {
    const slug = basename(file.path ?? "", extname(file.path ?? ""));
    if (!file.path?.includes(`${join("content", "docs", "packages")}`)) return;
    const where = `packages/${slug}/README.md`;
    const readme = parser.parse(readFileSync(join(PACKAGES_DIR, slug, "README.md"), "utf8"));
    expand(tree, readme, slug, where);
  };
}
