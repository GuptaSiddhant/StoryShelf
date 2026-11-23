import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { breadcrumbs, type NavUrls } from "./nav.ts";

const urls: NavUrls = {
  projects: () => "/projects",
  library: (slug) => `/p/${slug}/library`,
  buildsList: (slug) => `/p/${slug}/builds`,
  settings: (slug) => `/p/${slug}/settings`,
};

describe("breadcrumbs (ancestors of the current page only)", () => {
  it("is empty when the page is itself the section or has no section", () => {
    expect(breadcrumbs({ active: "projects" }, urls)).toEqual([]);
    expect(breadcrumbs(undefined, urls)).toEqual([]);
    expect(breadcrumbs({ active: "builds", projectSlug: "docs" }, urls)).toEqual([]);
    expect(breadcrumbs({ active: "admin" }, urls)).toEqual([]);
    expect(breadcrumbs({ active: "profile" }, urls)).toEqual([]);
  });

  it("lists the section as the parent of a deeper page", () => {
    expect(
      breadcrumbs({ active: "settings", projectSlug: "docs", trail: [{ label: "Tokens" }] }, urls),
    ).toEqual([{ label: "Settings", href: "/p/docs/settings" }]);
  });

  it("includes intermediate levels but not the current page", () => {
    expect(
      breadcrumbs(
        {
          active: "builds",
          projectSlug: "docs",
          trail: [{ label: "main · abc1234", href: "/p/docs/builds/b1" }, { label: "Review" }],
        },
        urls,
      ),
    ).toEqual([
      { label: "Builds", href: "/p/docs/builds" },
      { label: "main · abc1234", href: "/p/docs/builds/b1" },
    ]);
  });

  it("drops a trailing trail item on pages without a section (new project)", () => {
    expect(breadcrumbs({ active: "projects", trail: [{ label: "New project" }] }, urls)).toEqual(
      [],
    );
  });

  it("never returns a crumb without a link", () => {
    const crumbs = breadcrumbs(
      {
        active: "settings",
        projectSlug: "docs",
        trail: [{ label: "Labels" }, { label: "pr: 12" }],
      },
      urls,
    );
    expect(crumbs.every((crumb) => crumb.href !== undefined)).toBe(true);
  });

  it("does not repeat the section when the trail names it again", () => {
    expect(
      breadcrumbs(
        {
          active: "library",
          projectSlug: "docs",
          trail: [{ label: "Library", href: "/p/docs/library" }, { label: "Design coverage" }],
        },
        urls,
      ),
    ).toEqual([{ label: "Library", href: "/p/docs/library" }]);
  });
});

describe("breadcrumb rule across every page", () => {
  const pagesDir = new URL("../pages/", import.meta.url);
  const sources = readdirSync(pagesDir)
    .filter(
      (name) => name.endsWith(".tsx") && !name.includes(".stories.") && !name.includes(".test."),
    )
    .map((name) => ({ name, text: readFileSync(new URL(name, pagesDir), "utf8") }));

  it("ends every declared trail with the current page, which has no link", () => {
    const bad: string[] = [];
    for (const { name, text } of sources) {
      for (const match of text.matchAll(/trail:\s*\[([^\]]*)\]/gu)) {
        const items = [...(match[1] ?? "").matchAll(/\{[^{}]*\}/gu)].map((item) => item[0]);
        const last = items.at(-1);
        if (last?.includes("href")) {
          bad.push(`${name}: ${last}`);
        }
      }
    }
    expect(bad, "the last trail item is the current page and carries no href").toEqual([]);
  });

  it("gives every page below a section a trail", () => {
    const sections = ["admin", "profile"];
    const roots: Record<string, string> = { admin: "System", profile: "Profile" };
    const bad: string[] = [];
    for (const { name, text } of sources) {
      for (const section of sections) {
        for (const match of text.matchAll(
          new RegExp(`title="([^"]+)"\\s+nav=\\{\\{\\s*active: "${section}"\\s*\\}\\}`, "gu"),
        )) {
          if (match[1] !== roots[section]) {
            bad.push(`${name}: ${match[1]} is not the ${section} root`);
          }
        }
      }
    }
    expect(bad, "a page below System/Profile declares trail: [{ label }]").toEqual([]);
  });
});
