import { select, selectAll } from "hast-util-select";
// Runs after `astro build`: turns every built docs page into Markdown for people and AI tools.
//
//   dist/<page>/index.md   the page as Markdown (what "Copy page as Markdown" copies)
//   dist/llms.txt          an index of the docs, grouped like the sidebar (https://llmstxt.org)
//   dist/llms-full.txt     every docs page in one file (without the long changelog)
//
// The Markdown comes from the rendered HTML, not the source files, so shared README sections,
// components and generated tables are included exactly as readers see them. The generated
// TypeScript reference (`/reference/**`) and the HTTP API pages (`/api/**`) are left out of the
// full text: they are linked instead.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

const DIST = "dist";
const SITE = (process.env.SITE_URL ?? "https://storyshelf.js.org").replace(/\/$/u, "");
const BASE = (process.env.BASE_PATH ?? "/").replace(/\/$/u, "");
const SKIPPED = new Set(["reference", "api"]);

const htmlParser = unified().use(rehypeParse);
const toMdast = unified().use(rehypeRemark);
const toMarkdown = unified()
  .use(remarkGfm)
  .use(remarkStringify, { bullet: "-", emphasis: "*", fences: true, rule: "-" });

/** The text of a hast node. */
function textOf(node) {
  if (node.type === "text") return node.value;
  return (node.children ?? []).map((child) => textOf(child)).join("");
}

const element = (tagName, children, properties = {}) => ({
  type: "element",
  tagName,
  properties,
  children,
});
const text = (value) => ({ type: "text", value });

/** Every `<index.html>` under `dir`, as paths relative to `DIST`. */
function pagesIn(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pagesIn(path);
    return name === "index.html" ? [relative(DIST, path)] : [];
  });
}

/** `/guides/ci/` for `guides/ci/index.html` (and `/` for the home page). */
const hrefOf = (file) => `${BASE}/${file.replace(/index\.html$/u, "")}`;

/** Replace Expressive Code's per-line markup with a plain `<pre><code class="language-x">`. */
function simplifyCode(tree) {
  for (const pre of selectAll("pre[data-language]", tree)) {
    const lines = selectAll(".ec-line", pre).map((line) => textOf(line));
    const language = pre.properties?.["dataLanguage"];
    pre.properties = {};
    pre.children = [
      element("code", [text(lines.join("\n"))], {
        className: language && language !== "plaintext" ? [`language-${language}`] : [],
      }),
    ];
  }
}

/** Starlight asides become blockquotes that start with their title. */
function simplifyAsides(tree) {
  for (const aside of selectAll("aside.starlight-aside", tree)) {
    const title = textOf(select(".starlight-aside__title", aside) ?? aside).trim();
    const content = select(".starlight-aside__content", aside);
    aside.tagName = "blockquote";
    aside.properties = {};
    aside.children = [
      element("p", [element("strong", [text(`${title}:`)])]),
      ...(content?.children ?? []),
    ];
  }
}

/** A bold label followed by the content of one tab. */
const tabBlock = (label, children) => [
  element("p", [element("strong", [text(label)])]),
  ...children,
];

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/**
 * Tabs become a labelled block per tab. Package-manager tabs are the same command three times,
 * so only the first (npm) is kept, without a label.
 */
function simplifyTabs(tree) {
  for (const tabs of selectAll("starlight-tabs", tree)) {
    const labels = selectAll("[role=tab]", tabs).map((tab) => textOf(tab).trim());
    const panels = selectAll("[role=tabpanel]", tabs);
    const installers = labels.length > 0 && labels.every((label) => PACKAGE_MANAGERS.has(label));
    tabs.tagName = "div";
    tabs.properties = {};
    tabs.children = installers
      ? (panels[0]?.children ?? [])
      : panels.flatMap((panel, index) =>
          [
            element("p", [element("strong", [text(labels[index] ?? `Option ${index + 1}`)])]),
          ].concat(panel.children),
        );
  }
}

/** Screenshots come as a light and a dark image; keep the first of each alt text per parent. */
function dedupeImages(tree) {
  for (const parent of selectAll("*", tree)) {
    const seen = new Set();
    parent.children = (parent.children ?? []).filter((child) => {
      if (child.tagName !== "img") return true;
      const alt = String(child.properties?.["alt"] ?? "");
      if (seen.has(alt)) return false;
      seen.add(alt);
      return true;
    });
  }
}

/** Drop everything that only makes sense in a browser. */
function stripChrome(tree) {
  const noise = [
    "script",
    "style",
    "link",
    "template",
    "svg",
    "button",
    ".sl-anchor-link",
    ".sr-only",
    ".copy",
    "figcaption",
  ];
  for (const selector of noise) {
    for (const node of selectAll(selector, tree)) {
      node.type = "text";
      node.value = "";
      delete node.children;
    }
  }
}

/** Make site-relative links and images absolute so the Markdown works anywhere. */
function absolutize(tree) {
  for (const node of selectAll("a[href], img[src]", tree)) {
    const key = node.tagName === "a" ? "href" : "src";
    const value = String(node.properties?.[key] ?? "");
    if (value.startsWith("/") && !value.startsWith("//")) node.properties[key] = `${SITE}${value}`;
  }
}

/** Rewrite the content element of a page into the plain HTML that converts cleanly. */
function tidy(main) {
  stripChrome(main);
  simplifyCode(main);
  simplifyAsides(main);
  simplifyTabs(main);
  dedupeImages(main);
  absolutize(main);
}

/** Markdown for a tidied content element. */
function markdownOf(main) {
  const markdown = String(
    toMarkdown.stringify(toMdast.runSync({ type: "root", children: [main] })),
  );
  return markdown.replaceAll(/\n{3,}/gu, "\n\n").trim();
}

/** The page as Markdown, or `null` when it has no docs content. */
function convert(html, file) {
  const tree = htmlParser.parse(html);
  const main = select(".sl-markdown-content", tree);
  if (!main) return null;
  const title = textOf(select("h1#_top", tree) ?? select("h1", tree) ?? main).trim();
  const description = String(select("meta[name=description]", tree)?.properties?.["content"] ?? "");
  tidy(main);
  const url = `${SITE}${hrefOf(file)}`;
  const intro = [`# ${title}`, description && `> ${description}`, `Source: ${url}`]
    .filter(Boolean)
    .join("\n\n");
  return { title, description, url, markdown: `${intro}\n\n${markdownOf(main)}\n` };
}

/** The `<li>` entries of a sidebar list as nested `{ label, href?, items? }`. */
function walkSidebar(list) {
  return (list?.children ?? [])
    .filter((li) => li.tagName === "li")
    .map((li) => {
      const group = select("details", li);
      if (group) {
        const label = textOf(select("summary", group) ?? group).trim();
        return { label, items: walkSidebar(select("ul", group)) };
      }
      const link = select("a", li);
      return { label: textOf(link ?? li).trim(), href: String(link?.properties?.["href"] ?? "") };
    });
}

/** The sidebar of a built page as nested `{ label, href?, items? }` entries. */
function sidebarOf(file) {
  const tree = htmlParser.parse(readFileSync(join(DIST, file), "utf8"));
  return walkSidebar(select("sl-sidebar-state-persist ul", tree));
}

/** Markdown bullet list of a sidebar group, with descriptions where a page is known. */
function bullets(items, pages) {
  return items.flatMap((item) => {
    if (item.items) return bullets(item.items, pages);
    const page = pages.get(item.href);
    if (!page) return [];
    const note = page.description ? `: ${page.description}` : "";
    return [`- [${page.title}](${page.url}index.md)${note}`];
  });
}

/** One H2 section per top-level sidebar group. */
function sections(entries, pages, prefix = "") {
  return entries
    .filter((entry) => entry.items)
    .map((group) => {
      const subgroups = group.items.filter((item) => item.items && item.label !== "API");
      const own = group.items.filter((item) => !item.items);
      const lines = [
        ...bullets(own, pages),
        ...subgroups.flatMap((subgroup) => bullets(subgroup.items, pages)),
      ];
      return lines.length > 0 ? `## ${prefix}${group.label}\n\n${lines.join("\n")}` : "";
    })
    .filter(Boolean);
}

/** The pages of a sidebar, in order, for the full-text file. */
function orderOf(entries, pages) {
  return entries.flatMap((entry) => {
    if (entry.items) return orderOf(entry.items, pages);
    return pages.has(entry.href) ? [pages.get(entry.href)] : [];
  });
}

const files = pagesIn(DIST).filter((file) => {
  const first = file.split("/")[0];
  return file !== "index.html" && !SKIPPED.has(first);
});

const pages = new Map();
for (const file of files) {
  const page = convert(readFileSync(join(DIST, file), "utf8"), file);
  if (!page) continue;
  writeFileSync(join(DIST, file.replace(/index\.html$/u, "index.md")), page.markdown);
  pages.set(hrefOf(file), page);
}

const docsMenu = sidebarOf("guides/getting-started/index.html");
const packagesMenu = sidebarOf("packages/index.html");
const apiGuides = ["/guides/api/", "/guides/webhooks/"].map((href) => `${BASE}${href}`);
const referenceDirs = readdirSync(join(DIST, "reference")).toSorted();

const index = [
  "# StoryShelf",
  "> Self-hosted visual testing for Storybook: run visual regression tests in CI, review pixel diffs in the browser, approve changes before they ship, and publish the Storybook. Unlimited snapshots, no vendor lock-in.",
  `Every page below is available as Markdown at its URL plus \`index.md\`. The whole documentation is in one file: [llms-full.txt](${SITE}/llms-full.txt).`,
  ...sections(docsMenu, pages),
  ...sections(packagesMenu, pages, "Packages: "),
  `## HTTP API\n\n${[
    `- [OpenAPI specification](${SITE}/openapi.json): every endpoint, in OpenAPI 3 JSON`,
    ...bullets(
      apiGuides.map((href) => ({ href, label: "" })),
      pages,
    ),
  ].join("\n")}`,
  `## Optional\n\n${[
    `- [HTTP API reference](${SITE}/api/): the generated endpoint pages`,
    ...referenceDirs.map(
      (name) => `- [TypeScript API: @storyshelf/${name}](${SITE}${BASE}/reference/${name}/)`,
    ),
  ].join("\n")}`,
].join("\n\n");
writeFileSync(join(DIST, "llms.txt"), `${index}\n`);

const ordered = [
  ...orderOf(docsMenu, pages),
  ...apiGuides.flatMap((href) => (pages.has(href) ? [pages.get(href)] : [])),
  ...orderOf(packagesMenu, pages),
];
const seen = new Set();
const full = ordered
  .filter((page) => !page.url.endsWith("/changelog/") && !seen.has(page.url) && seen.add(page.url))
  .map((page) => page.markdown.trim())
  .join("\n\n---\n\n");
writeFileSync(join(DIST, "llms-full.txt"), `${full}\n`);

process.stdout.write(`markdown export: ${pages.size} pages, llms.txt, llms-full.txt\n`);
