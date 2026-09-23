import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ratchet for the `ui-building-blocks` contract: pages compose facade
 * components, never raw classes or inline styles.
 *
 * - No `class="btn..."` / `class="tabs..."` literals in `pages/` (use
 *   `Button` / `Tabs` from `ui/components.tsx`; `btn-link` in storybook.tsx
 *   is a separate one-off outside the system).
 * - No direct family imports in `pages/` (facade + document shell only).
 * - Inline `style="..."` per file may only shrink (map below is the
 *   current ceiling; lower it when migrating a file, never raise it).
 */
const pagesDir = fileURLToPath(new URL("../pages", import.meta.url));

const styleCeiling: Record<string, number> = {
  "build-detail.tsx": 16,
  "build-diff-header.tsx": 1,
  "compute-jobs.tsx": 9,
  "label-detail.tsx": 5,
  "library.tsx": 11,
  "login.tsx": 1,
  "project-builds.tsx": 7,
  "project-create.tsx": 2,
  "projects.tsx": 3,
  "root.tsx": 9,
  "settings-general.tsx": 3,
  "settings-labels.tsx": 4,
  "settings-members.tsx": 6,
  "settings-status.tsx": 4,
  "settings-tests.tsx": 5,
  "settings-tokens.tsx": 4,
  "settings-webhooks.tsx": 5,
};

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
  it("has no raw button, tab, badge, alert, empty, or stat classes in pages/", async () => {
    const forbidden =
      /class="btn(?:"|\s)|class="tabs(?:"|\s)|tabs__link|class="badge(?:"|\s)|badge--[a-z]+|class="alert(?:"|\s)|alert--[a-z]+|alert__title|alert__body|class="empty(?:"|\s)|empty__title|empty__desc|empty__action|class="stat(?:"|\s)|stat__value|stat__label/u;
    const offenders = (await pageSources()).filter(({ source }) => forbidden.test(source));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("imports UI only through the facade and the document shell", async () => {
    const directImport =
      /from\s+"\.\.\/ui\/(?!components\.tsx|document\.tsx|csrf-field\.tsx)[^"]+"/u;
    const offenders = (await pageSources()).filter(({ source }) => directImport.test(source));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("keeps inline styles at or below the ceiling per file", async () => {
    const over = (await pageSources())
      .map(({ file, source }) => ({ file, count: countMatches(source, /style="/gu) }))
      .filter(({ file, count }) => count > (styleCeiling[file] ?? 0));
    expect(over).toEqual([]);
  });
});
