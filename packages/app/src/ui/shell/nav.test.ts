import { describe, expect, it } from "vitest";
import { breadcrumbs, type NavUrls } from "./nav.ts";

const urls: NavUrls = {
  projects: () => "/projects",
  library: (slug) => `/p/${slug}/library`,
  buildsList: (slug) => `/p/${slug}/builds`,
  jobs: (slug) => `/p/${slug}/jobs`,
  labels: (slug) => `/p/${slug}/labels`,
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
      { active: "labels", projectSlug: "docs", trail: [{ label: "pr: 12" }] },
      urls,
    );
    expect(crumbs.every((crumb) => crumb.href !== undefined)).toBe(true);
  });
});
