import { createShelfLogger } from "@storyshelf/core/logger";
import { ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { assetManifest } from "../../asset-manifest.ts";
import { createShelfApp } from "../../index.tsx";

type Db = ReturnType<typeof makeDatabase>["db"];

async function page(path: string, seed?: (db: Db) => Promise<void>): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await seed?.(db);
  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  return await (await app.request(path)).text();
}

const twoProjects = async (db: Db): Promise<void> => {
  const projects = new ProjectModel(db);
  await projects.create({ name: "Alpha" });
  await projects.create({ name: "Beta" });
};

describe("app shell", () => {
  it("references hashed assets and mounts the toast region and backdrop", async () => {
    const html = await page("/projects");
    expect(html).toContain(`src="${assetManifest.htmx.href}"`);
    expect(html).toContain("data-toast-region");
    expect(html).toContain("data-sidebar-backdrop");
    expect(html).toContain('aria-label="Primary"');
  });

  it("marks the active nav entry and omits project links outside a project", async () => {
    const html = await page("/projects");
    expect(html).toMatch(/sidebar__link--active[^>]*href="\/projects"/u);
    expect(html).not.toContain(">Library<");
    expect(html).toContain(">Developer<");
  });

  it("shows project nav and a switcher listing every project inside a project", async () => {
    const html = await page("/projects/alpha/builds", twoProjects);
    for (const label of ["Library", "Builds", "Jobs", "Labels", "Settings"]) {
      expect(html).toContain(`<span class="sidebar__label">${label}</span>`);
    }
    expect(html).toContain('aria-label="Project: Alpha"');
    expect(html).toContain(">Beta<");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("All projects");
  });

  it("offers Light, Dark, and System in the theme menu", async () => {
    const html = await page("/projects");
    for (const mode of ["light", "dark", "system"]) {
      expect(html).toContain(`data-theme-set="${mode}"`);
    }
  });

  it("no longer renders the old blue top bar markup", async () => {
    const html = await page("/projects");
    expect(html).not.toContain('topbar__theme" type="button"');
    expect(html).not.toContain("user-menu__logout");
  });
});

/** The rendered top bar markup. */
function bar(html: string): string {
  return html.slice(html.indexOf('role="banner"'), html.indexOf("</header>"));
}

describe("top bar and sidebar footer", () => {
  it("puts account, theme, and collapse in the sidebar footer, not the top bar", async () => {
    const html = await page("/projects");
    const sidebar = html.slice(html.indexOf('<aside id="sidebar"'), html.indexOf("</aside>"));
    const topbar = html.slice(html.indexOf('role="banner"'), html.indexOf("</header>"));
    expect(sidebar).toContain("data-theme-set");
    expect(sidebar).toContain("data-sidebar-collapse");
    expect(sidebar).toContain('aria-label="Collapse or expand sidebar"');
    expect(topbar).not.toContain("data-theme-set");
  });

  it("shows the project picker and the page's ancestors, not the page itself", async () => {
    const section = await page("/projects/alpha/builds", twoProjects);
    const deeper = await page("/projects/alpha/settings/tokens", twoProjects);
    expect(bar(section)).toContain('aria-label="Project: Alpha"');
    expect(bar(section)).not.toContain('aria-label="Breadcrumb"');
    expect(bar(deeper)).toContain('aria-label="Breadcrumb"');
    expect(bar(deeper)).toContain(">Settings</a>");
    expect(bar(deeper)).not.toContain("Tokens");
  });

  it("reads 'All projects' on global pages with no breadcrumb", async () => {
    const projects = await page("/projects");
    const admin = await page("/admin");
    expect(projects).toContain('aria-label="Project: All projects"');
    expect(projects).not.toContain('aria-label="Breadcrumb"');
    expect(admin).not.toContain('aria-label="Breadcrumb"');
  });
});
