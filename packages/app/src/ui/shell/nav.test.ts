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

describe("breadcrumbs", () => {
  it("is empty on the projects overview", () => {
    expect(breadcrumbs({ active: "projects" }, urls)).toEqual([]);
    expect(breadcrumbs(undefined, urls)).toEqual([]);
  });

  it("shows only the current section (no link) when the page does not go deeper", () => {
    expect(breadcrumbs({ active: "builds", projectSlug: "docs" }, urls)).toEqual([
      { label: "Builds" },
    ]);
  });

  it("links the section and marks the last trail item as current", () => {
    const crumbs = breadcrumbs(
      {
        active: "builds",
        projectSlug: "docs",
        trail: [{ label: "main · abc1234", href: "/p/docs/builds/b1" }, { label: "Review" }],
      },
      urls,
    );
    expect(crumbs).toEqual([
      { label: "Builds", href: "/p/docs/builds" },
      { label: "main · abc1234", href: "/p/docs/builds/b1" },
      { label: "Review" },
    ]);
  });

  it("strips the href from a trailing trail item so it reads as the current page", () => {
    expect(
      breadcrumbs({ active: "projects", trail: [{ label: "New project", href: "/x" }] }, urls),
    ).toEqual([{ label: "New project" }]);
  });

  it("knows the global sections", () => {
    expect(breadcrumbs({ active: "admin" }, urls)).toEqual([{ label: "System" }]);
    expect(breadcrumbs({ active: "profile" }, urls)).toEqual([{ label: "Profile" }]);
  });
});
