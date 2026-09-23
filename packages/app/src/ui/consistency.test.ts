import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ratchet for the `ui-building-blocks` contract: pages compose facade
 * components, never raw classes or inline styles.
 *
 * - No component classes in `pages/` (use the facade; `btn-link` in
 *   storybook.tsx is a separate one-off outside the system).
 * - No direct family imports in `pages/` (facade + document shell +
 *   shared review styles + page-local `ui/css.ts` only).
 * - No inline `style="..."` in `pages/` at all (zero ceiling).
 */
const pagesDir = fileURLToPath(new URL("../pages", import.meta.url));

async function pageSources(): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(pagesDir);
  const pages = entries.filter((entry) => entry.endsWith(".tsx")).toSorted();
  return await Promise.all(
    pages.map(async (file) => ({ file, source: await readFile(`${pagesDir}/${file}`, "utf8") })),
  );
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe("ui-building-blocks contract", () => {
  it("has no raw component or retired utility classes in pages/", async () => {
    const forbidden =
      /class="btn(?:"|\s)|class="tabs(?:"|\s)|tabs__link|class="badge(?:"|\s)|badge--[a-z]+|class="alert(?:"|\s)|alert--[a-z]+|alert__title|alert__body|class="empty(?:"|\s)|empty__title|empty__desc|empty__action|class="stat(?:"|\s)|stat__value|stat__label|class="field(?:"|\s)|field__label|field__input|field__hint|field__error|class="card(?:"|\s)|card--padded|class="page-header(?:"|\s)|page-header__title|page-header__desc|page-header__meta|page-header__actions|page-header__row|class="breadcrumbs(?:"|\s)|class="diff-[a-z-]+|class="review-[a-z-]+|class="snapshot-[a-z-]+|class="segmented(?:"|\s)|comment__head|comment__body|comment__actions|class="row-actions(?:"|\s)|class="split(?:"|\s)|class="stack(?:"|\s)/u;
    const offenders = (await pageSources()).filter(({ source }) => forbidden.test(source));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("imports UI only through the facade, the document shell, shared review styles, and page-local css", async () => {
    const directImport =
      /from\s+"\.\.\/ui\/(?!components\.tsx|document\.tsx|csrf-field\.tsx|css\.ts|styles\/review\.ts)[^"]+"/u;
    const offenders = (await pageSources()).filter(({ source }) => directImport.test(source));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("has no inline styles in pages/", async () => {
    const over = (await pageSources())
      .map(({ file, source }) => ({ file, count: countMatches(source, /style="/gu) }))
      .filter(({ count }) => count > 0);
    expect(over).toEqual([]);
  });
});
