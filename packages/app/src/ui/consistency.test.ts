import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ratchet for the `ui-building-blocks` contract: pages compose facade
 * components, never raw classes or inline styles.
 *
 * - No component classes in `pages/` (use the facade).
 * - No direct family imports in `pages/` (facade + document shell +
 *   shared review styles + page-local `ui/css.ts` only).
 * - No inline `style="..."` in `pages/` or `src/ui/` at all (zero ceiling).
 * - No card inside a card in `pages/` (a nested `<Card>` is a section, not a second box).
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
const PAGE_SHELL_IMPORTS =
  /^\.\.\/shell\/(?:document|csrf-field|form-page|preview-document)\.tsx$/u;

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

/** Whether a `<Card>` opens before the enclosing one closes (`CardSection` and self-closing cards are fine). */
function hasNestedCard(source: string): boolean {
  let depth = 0;
  for (const [token] of source.matchAll(/<Card(?=[\s>/])[^>]*?(\/?)>|<\/Card>/gu)) {
    if (token === "</Card>") {
      depth -= 1;
    } else if (!token.endsWith("/>")) {
      depth += 1;
      if (depth > 1) {
        return true;
      }
    }
  }
  return false;
}

/** Settings and admin pages: the ones that must open forms from summaries (ADR 0012, decision 10). */
function isSettingsPage(file: string): boolean {
  return /settings|^admin/u.test(file);
}

/** `<form>` elements with more than one input, on a page. A page with a form page of its own renders it outside these files. */
function inlineForms(source: string): number {
  const forms = [...source.matchAll(/<form\b[\s\S]*?<\/form>/gu)].map(([form]) => form);
  return forms.filter(
    (form) =>
      countMatches(
        form,
        /<(?:Field|TextareaField|SelectField|CheckField|input|select|textarea)\b/gu,
      ) > 1,
  ).length;
}

/**
 * Pages that still render a multi-input form inline: the ratchet's current allowance. It can only
 * shrink (move the form into a `Dialog` or its own page, then delete the entry).
 */
const INLINE_FORM_ALLOWANCE: Record<string, number> = {
  "settings-labels.tsx": 2,
  "settings-links.tsx": 1,
  "settings-notifications.tsx": 1,
  "settings-tests.tsx": 1,
};

/** Files that still render a list with `<ul>`/`<ol>` (a real list of prose items), with their counts. Shrink it. */
const LIST_ALLOWANCE: Record<string, number> = {
  "a11y-violations.tsx": 1,
  "build-detail-skipped.tsx": 2,
  "review-change-requests.tsx": 1,
  "settings-component-owners.tsx": 1,
};

/** A ✓, ✗ or → in JSX text (between tags) or as a one-glyph string child, not in a comment or template. */
const JSX_GLYPH = /(?<![=-])>[^<>{}*;]*[✓✗→][^<>{}*;]*<|\?\s*"[✓✗→] ?"/u;

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

  it("renders no multi-input form inline on a settings or admin page beyond the allowance", async () => {
    const found: Record<string, number> = {};
    for (const { file, source } of await pageSources()) {
      const count = isSettingsPage(file) ? inlineForms(source) : 0;
      if (count > 0) {
        found[file] = count;
      }
    }
    expect(found).toEqual(INLINE_FORM_ALLOWANCE);
  });

  it("counts a form with two inputs and ignores a single-input one", () => {
    expect(inlineForms("<form><Field /><Field /></form>")).toBe(1);
    expect(inlineForms("<form><input /><Button /></form>")).toBe(0);
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

  it("keeps one focus ring: no `outline: none` and no `&:focus {` in ui css outside the field ring", async () => {
    const offenders = (await uiSources())
      .filter(({ file }) => file.endsWith(".tsx") && !file.includes(".stories."))
      .filter(({ source }) => /outline:\s*none|&:focus\s*\{/u.test(source))
      .map(({ file }) => file);
    // compare-stage.tsx drops the decorative outline of a scaled image, which is not a focus ring.
    expect(offenders.toSorted()).toEqual(["compare-stage.tsx"]);
  });

  it("styles `[aria-disabled]` wherever `&:disabled` is styled in a component that can render a link", async () => {
    const offenders = (await uiSources())
      .filter(({ file }) => file === "buttons.tsx")
      .filter(
        ({ source }) => source.includes("&:disabled") && !source.includes('[aria-disabled="true"]'),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("has no card inside a card in pages/", async () => {
    const nested = (await pageSources())
      .filter(({ source }) => hasNestedCard(source))
      .map(({ file }) => file);
    expect(nested).toEqual([]);
  });

  it("has no <details> or <summary> in pages/ (Disclosure and Dropdown own them)", async () => {
    const found = (await pageSources())
      .filter(
        ({ file, source }) =>
          !file.endsWith(".test.tsx") && /<details[\s>]|<summary[\s>]/u.test(source),
      )
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it("has no bare <ul> or <ol> in pages/ beyond the allow-list", async () => {
    const found: Record<string, number> = {};
    for (const { file, source } of await pageSources()) {
      const count = countMatches(source, /<(?:ul|ol)[\s>]/gu);
      if (count > 0) {
        found[file] = count;
      }
    }
    expect(found).toEqual(LIST_ALLOWANCE);
  });

  it("prints no ✓, ✗ or → character in JSX text in pages/ (use Icon)", async () => {
    const found = (await pageSources())
      .filter(({ file, source }) => !file.endsWith(".test.tsx") && JSX_GLYPH.test(source))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it("recognises a glyph in JSX text and ignores one in a string or comment", () => {
    expect(JSX_GLYPH.test("<span>✓ done</span>")).toBe(true);
    expect(JSX_GLYPH.test('{decided ? "✓ " : ""}')).toBe(true);
    expect(JSX_GLYPH.test("<span>Story →</span>")).toBe(true);
    expect(JSX_GLYPH.test("// System → Git page")).toBe(false);
    expect(JSX_GLYPH.test("const label = `${a} → ${b}`;")).toBe(false);
  });

  it("recognises a card nested in a card", () => {
    expect(hasNestedCard("<Card><Card>x</Card></Card>")).toBe(true);
    expect(hasNestedCard('<Card id="a"><p>x</p><Card padded={false} /></Card>')).toBe(false);
    expect(hasNestedCard("<Card><CardSection>x</CardSection></Card><Card>y</Card>")).toBe(false);
  });
});

/** Type and colour rules from the visual review (#1127, #1129). */
describe("type and colour tokens", () => {
  const srcDir = fileURLToPath(new URL("..", import.meta.url));

  /** Non-test, non-story sources of ui/, shell/ and pages/, minus the standalone Storybook frame page. */
  async function styledSources(): Promise<Array<{ file: string; source: string }>> {
    const groups = await Promise.all(
      ["ui", "shell", "pages"].map(async (dir) => {
        const entries = await readdir(`${srcDir}${dir}`, { recursive: true });
        const files = entries
          .filter((entry) => /\.tsx?$/u.test(entry) && !/\.(?:test|stories)\.tsx?$/u.test(entry))
          .toSorted();
        return await Promise.all(
          files.map(async (file) => ({
            file: `${dir}/${file}`,
            source: await readFile(`${srcDir}${dir}/${file}`, "utf8"),
          })),
        );
      }),
    );
    return groups.flat();
  }

  const offendersOf = async (pattern: RegExp, skip: RegExp | null = null): Promise<string[]> =>
    (await styledSources())
      .filter(({ file }) => !skip?.test(file))
      .flatMap(({ file, source }) =>
        [...source.matchAll(pattern)].map((hit) => `${file}: ${hit[0]}`),
      );

  it("sets every font-size from the text scale", async () => {
    expect(
      await offendersOf(/font-size:\s+(?!var\(--text-(?:xs|sm|base|lg|xl|2xl)\))[^;}\n]+/gu),
    ).toEqual([]);
  });

  it("sets every font-weight from the weight tokens", async () => {
    expect(
      await offendersOf(
        /font-weight:\s+(?!var\(--weight-(?:normal|medium|semibold|bold)\))[^;}\n]+/gu,
      ),
    ).toEqual([]);
  });

  it("renders no section header as a level-2 PageHeader in a page", async () => {
    const offenders = (await pageSources()).filter(({ source }) =>
      /<PageHeader\s[^>]*?level=\{2\}/u.test(source),
    );
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("renders a PageHeader at most once per page file, bar the files whose branches are exclusive", async () => {
    // These render one header per mutually exclusive branch (empty, populated, error), never two at once.
    const exclusiveBranches: Record<string, number> = {
      "invite.tsx": 2,
      "label-detail.tsx": 2,
      "library.tsx": 3,
    };
    const offenders = (await pageSources())
      .map(({ file, source }) => ({ file, count: source.match(/<PageHeader[\s>]/gu)?.length ?? 0 }))
      .filter(({ file, count }) => count > (exclusiveBranches[file] ?? 1));
    expect(offenders).toEqual([]);
  });

  it("prints no raw status, verdict, role, kind or provider enum as a badge label", async () => {
    const raw =
      /<Badge[^>]*>\s*\{[^{}()]*\.(?:status|verdict|role|kind|provider|level|value|state|method)\}\s*<\/Badge>/gu;
    expect(await offendersOf(raw)).toEqual([]);
  });

  it("draws no small solid danger button (a row action is danger-secondary)", async () => {
    const solid = /<Button\b(?=[^>]*variant="danger")(?=[^>]*size="sm")[^>]*>/gu;
    expect(await offendersOf(solid, /^ui\//u)).toEqual([]);
  });

  it("spaces page blocks with the page column and stacks, not margin wrappers", async () => {
    // `.mt-1` / `.mb-1` inside the page column or a card doubled the gap (32 px, #1286 L4).
    expect(await offendersOf(/class="(?:[\w-]+ )*m[tb]-1(?: [\w-]+)*"/gu, /^ui\//u)).toEqual([]);
  });

  it("formats no date by slicing an ISO string in pages or the shell", async () => {
    const slicing = /\.slice\(0, (?:10|16)\)|\btoISOString\(\)/gu;
    expect(await offendersOf(slicing, /^ui\/|^shell\/service-worker-sync\.ts$/u)).toEqual([]);
  });

  it("writes no hex colour in styles outside the theme and token modules", async () => {
    expect(
      await offendersOf(
        /(?:color|background|border|fill|stroke|outline|shadow|mix)[\w-]*[:(][^;\n]*#[0-9a-fA-F]{3,8}\b/gu,
        /^ui\/(?:theme|styles\/tokens)\.ts$|^ui\/design-reference|assets\//u,
      ),
    ).toEqual([]);
  });
  it("sets padding, margin and gap from the space scale", async () => {
    // A value is `0`, `auto` or built from `var(--space-N)` (inside `calc` for a negative or a multiple).
    const spacing =
      /(?<![-\w])(?:padding|margin|gap)(?:-[a-z]+)*\s*:(?!\s*(?:(?:0|auto|var\(--swipe[^)]*\)|var\(--space-[1-8]\)|calc\([^;}\n]*var\(--space-[1-8]\)[^;}\n]*\))\s*)+(?:[;}\n`]|$))[^;}\n]*/gu;
    expect(await offendersOf(spacing, /^ui\/(?:styles\/base|stacks)\.(?:ts|tsx)$/u)).toEqual([]);
  });

  it("puts every section title (h2) of a page inside a Card", async () => {
    // A section is a `Card` whose first child is a `SectionTitle`; a heading on the page background
    // (with its description outside the card) made sibling sections look different (#1286 L5).
    // h3 (`level={3}`) is a subsection and may sit in a component a card wraps.
    const offenders = (await pageSources())
      .filter(({ file }) => !file.endsWith(".stories.tsx"))
      .flatMap(({ file, source }) => {
        let depth = 0;
        const found: string[] = [];
        for (const match of source.matchAll(
          /<Card\b[^>]*?(?<self>\/?)>|<\/Card>|<SectionTitle(?<level>[^>]*)>/gu,
        )) {
          const [token = ""] = match;
          if (token.startsWith("</Card")) {
            depth -= 1;
          } else if (token.startsWith("<Card")) {
            depth += token.endsWith("/>") ? 0 : 1;
          } else if (depth <= 0 && !/level=\{3\}/u.test(match.groups?.["level"] ?? "")) {
            found.push(`${file}: ${source.slice(0, match.index).split("\n").length}`);
          }
        }
        return found;
      });
    expect(offenders).toEqual([]);
  });

  it("writes no hex colour or font-family literal in a page outside a css template", async () => {
    // A plain `<style>` string in a page escaped the css-template checks and hard-coded #ddd and
    // system-ui (#1285 V5). Colours and fonts come from the token stylesheet.
    const literal =
      /(?:(?:color|background|border|fill|stroke|outline|shadow)[\w-]*\s*[:=(][^;\n]*#[0-9a-fA-F]{3,8}\b|font-family\s*:)/u;
    const outside = (await pageSources())
      .filter(({ file }) => !file.endsWith(".stories.tsx"))
      .flatMap(({ file, source }) =>
        source
          .replaceAll(/css`[^`]*`/gu, "")
          .split("\n")
          .filter((line) => literal.test(line))
          .map((line) => `${file}: ${line.trim()}`),
      );
    expect(outside).toEqual([]);
  });

  it("sets the height of a control from the control tokens", async () => {
    expect(await offendersOf(/min-height:\s*\d+px/gu)).toEqual([]);
  });

  it("gives SectionTitle and PageHeader no margin of their own", async () => {
    const layout = (await styledSources()).find(({ file }) => file === "ui/layout.tsx");
    const blocks = [
      ...(layout?.source ?? "").matchAll(/\/\* (section-title[\w-]*|page-header) \*\/[^`]*/gu),
    ];
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.filter(([block]) => /margin:(?!\s*0;)/u.test(block))).toEqual([]);
  });

  it("positions every scroller (a .visually-hidden child is absolute)", async () => {
    // `overflow: auto` / `overflow-x: auto` without a positioned ancestor lets an absolute
    // child escape the scroller and widen the page (#1133, P1). A `css` template that scrolls
    // also sets `position: relative` (or sticky/absolute/fixed) at its top level (two-space indent).
    const offenders: string[] = [];
    for (const { file, source } of await styledSources()) {
      for (const [, body = ""] of source.matchAll(/css`([^`]*)`/gu)) {
        const label = /\/\* ([\w-]+) \*\//u.exec(body)?.[1] ?? "unlabeled";
        const scrolls = /\n {2}overflow(?:-x)?:\s*(?:auto|scroll)/u.test(body);
        const positioned = /\n {2}position:\s*(?:relative|sticky|absolute|fixed)/u.test(body);
        if (scrolls && !positioned) {
          offenders.push(`${file}: ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses only the three named breakpoints", async () => {
    expect(await offendersOf(/@media \(max-width:(?!\s*(?:480|880|1024)px\))[^)]*\)/gu)).toEqual(
      [],
    );
  });
});
