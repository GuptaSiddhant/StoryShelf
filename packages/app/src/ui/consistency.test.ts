import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

/**
 * Ratchet for the `ui-building-blocks` contract: pages compose facade
 * components, never raw classes or inline styles.
 *
 * - No component classes in `pages/` (use the facade; `btn-link` in
 *   storybook.tsx is a separate one-off outside the system).
 * - No direct family imports in `pages/` (facade + document shell +
 *   shared review styles + page-local `ui/css.ts` only).
 * - No inline `style="..."` in `pages/` or `src/ui/` at all (zero ceiling).
 * - `src/ui/` stays presentational: no store, routers, middleware, pages, core models or
 *   test-helpers (the app-coupled chrome lives in `src/shell/`).
 */
const pagesDir = fileURLToPath(new URL("../pages", import.meta.url));
const uiDir = `${import.meta.dirname}/`;

async function pageSources(): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(pagesDir);
  const pages = entries.filter((entry) => entry.endsWith(".tsx")).toSorted();
  return await Promise.all(
    pages.map(async (file) => ({ file, source: await readFile(`${pagesDir}/${file}`, "utf8") })),
  );
}

/** Every non-test source under `src/ui/`, with its path relative to it. */
async function uiSources(): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(uiDir, { recursive: true });
  const files = entries
    .filter((entry) => /\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry))
    .toSorted();
  return await Promise.all(
    files.map(async (file) => ({ file, source: await readFile(`${uiDir}${file}`, "utf8") })),
  );
}

/** Module specifiers a source imports (static, side-effect and dynamic). */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/gu)].map(
    (match) => match[1] ?? "",
  );
}

/** App state or server wiring: what the presentational `ui/` must not reach. */
function reachesAppState(specifier: string): boolean {
  if (specifier.startsWith("@storyshelf/core/")) {
    return /^@storyshelf\/core\/(?:models|test-helpers)(?:\/|$)/u.test(specifier);
  }
  return /^\.\.?\/(?:.*\/)?(?:store(?:\.tsx?)?$|(?:routers|middleware|pages|shell)\/)/u.test(
    specifier,
  );
}

const PAGE_UI_IMPORTS = /^\.\.\/ui\/(?:components\.tsx|css\.ts|styles\/review(?:-[a-z]+)?\.ts)$/u;
const PAGE_SHELL_IMPORTS = /^\.\.\/shell\/(?:document|csrf-field)\.tsx$/u;

/** A page import that bypasses the facade, or reaches a shell module other than document and csrf-field. */
function breaksPageContract(specifier: string): boolean {
  if (specifier.startsWith("../ui/")) {
    return !PAGE_UI_IMPORTS.test(specifier);
  }
  return specifier.startsWith("../shell/") && !PAGE_SHELL_IMPORTS.test(specifier);
}

function pageSourceBreaksContract(source: string): boolean {
  return importSpecifiers(source).some((specifier) => breaksPageContract(specifier));
}

/** Patterns for a runtime reference to `@storyshelf/core/urls`; erased `type` forms are not matched. */
const RUNTIME_URLS_REFERENCES: readonly RegExp[] = [
  /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']@storyshelf\/core\/urls["']/mu,
  /^\s*import\s+["']@storyshelf\/core\/urls["']/mu,
  /\bimport\s*\(\s*["']@storyshelf\/core\/urls["']/u,
];

function usesUrlsAtRuntime(source: string): boolean {
  return RUNTIME_URLS_REFERENCES.some((pattern) => pattern.test(source));
}

/** A JSX `style` attribute in any spelling: `style="..."`, `style='...'`, `style={...}`, with spaces. */
const INLINE_STYLE = /\bstyle\s*=\s*["'{`]/gu;

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe("ui-building-blocks contract", () => {
  it("has no raw component or retired utility classes in pages/", async () => {
    const forbidden =
      /class="btn(?:"|\s)|class="tabs(?:"|\s)|tabs__link|class="badge(?:"|\s)|badge--[a-z]+|class="alert(?:"|\s)|alert--[a-z]+|alert__title|alert__body|class="empty(?:"|\s)|empty__title|empty__desc|empty__action|class="stat(?:"|\s)|stat__value|stat__label|class="field(?:"|\s)|field__label|field__input|field__hint|field__error|class="card(?:"|\s)|card--padded|class="page-header(?:"|\s)|page-header__title|page-header__desc|page-header__meta|page-header__actions|page-header__row|class="breadcrumbs(?:"|\s)|class="diff-[a-z-]+|class="review-[a-z-]+|class="snapshot-[a-z-]+|class="segmented(?:"|\s)|comment__head|comment__body|comment__actions|class="row-actions(?:"|\s)|class="split(?:"|\s)|class="stack(?:"|\s)|class="table-wrap|class="login(?:"|\s)/u;
    const offenders = (await pageSources()).filter(({ source }) => forbidden.test(source));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("imports UI only through the facade, the document shell, shared review styles, and page-local css", async () => {
    const offenders = (await pageSources()).filter(({ source }) =>
      pageSourceBreaksContract(source),
    );
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("keeps src/ui presentational: no store, routers, middleware, pages or core models", async () => {
    const offenders = (await uiSources()).flatMap(({ file, source }) =>
      importSpecifiers(source)
        .filter((specifier) => reachesAppState(specifier))
        .map((specifier) => `${file}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("imports @storyshelf/core/urls in src/ui as types only", async () => {
    const offenders = (await uiSources()).filter(({ source }) => usesUrlsAtRuntime(source));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("recognises the app-coupled imports the boundary forbids", () => {
    const forbidden = [
      "../store.ts",
      "../../store.ts",
      "../store",
      "../../store",
      "../routers/ui.ts",
      "../middleware/csrf.ts",
      "../pages/login.tsx",
      "../shell/document.tsx",
      "@storyshelf/core/models",
      "@storyshelf/core/test-helpers",
    ];
    const allowed = ["./css.ts", "../ui/components.tsx", "hono/jsx", "@storyshelf/core/urls"];
    expect(forbidden.filter((specifier) => !reachesAppState(specifier))).toEqual([]);
    expect(allowed.filter((specifier) => reachesAppState(specifier))).toEqual([]);
  });

  it("recognises page imports that break the facade or reach other shell modules", () => {
    const sources = [
      'import { Sidebar } from "../shell/sidebar.tsx";',
      'export { navItems } from "../shell/nav.ts";',
      'import "../shell/client-script.ts";',
      'const nav = await import("../shell/nav.ts");',
      'import { Button } from "../ui/buttons.tsx";',
    ];
    const allowed = [
      'import { DocumentLayout } from "../shell/document.tsx";',
      'import { csrfField } from "../shell/csrf-field.tsx";',
      'import { Button } from "../ui/components.tsx";',
      'import { css } from "../ui/css.ts";',
      'import { grid } from "../ui/styles/review-layout.ts";',
      'import { helper } from "./settings-links.tsx";',
    ];
    expect(sources.filter((source) => !pageSourceBreaksContract(source))).toEqual([]);
    expect(allowed.filter((source) => pageSourceBreaksContract(source))).toEqual([]);
  });

  it("recognises runtime references to @storyshelf/core/urls and ignores type-only ones", () => {
    const urls = '"@storyshelf/core/urls"';
    const runtime = [
      `import { createUrlBuilder } from ${urls};`,
      `import {\n  createUrlBuilder,\n} from ${urls};`,
      `import { type UrlBuilder } from ${urls};`,
      `export { createUrlBuilder } from ${urls};`,
      `export * from ${urls};`,
      `import ${urls};`,
      `const urls = await import(${urls});`,
    ];
    const erased = [
      `import type { UrlBuilder } from ${urls};`,
      `export type { UrlBuilder } from ${urls};`,
      "const unrelated = 1;",
    ];
    expect(runtime.filter((source) => !usesUrlsAtRuntime(source))).toEqual([]);
    expect(erased.filter((source) => usesUrlsAtRuntime(source))).toEqual([]);
  });

  it("has no inline styles in pages/", async () => {
    const over = (await pageSources())
      .map(({ file, source }) => ({ file, count: countMatches(source, /style="/gu) }))
      .filter(({ count }) => count > 0);
    expect(over).toEqual([]);
  });

  it("recognises every spelling of a JSX inline style", () => {
    const spellings = [
      '<i style="width:1px" />',
      "<i style='width:1px' />",
      "<i style={{ a: 1 }} />",
    ];
    const spaced = ['<i style = "width:1px" />', "<i style\n={`width:1px`} />"];
    for (const source of [...spellings, ...spaced]) {
      expect(countMatches(source, INLINE_STYLE), source).toBe(1);
    }
    // The word in prose, or as part of another name, is not a style attribute.
    expect(countMatches("// the style rules; unstyled = {}; restyle={1}", INLINE_STYLE)).toBe(0);
  });

  it("has no inline styles in src/ui/", async () => {
    // css.ts only mentions the word in prose.
    const over = (await uiSources())
      .filter(({ file }) => file !== "consistency.test.ts")
      .map(({ file, source }) => ({ file, count: countMatches(source, INLINE_STYLE) }))
      .filter(({ count }) => count > 0);
    expect(over).toEqual([]);
  });
});
