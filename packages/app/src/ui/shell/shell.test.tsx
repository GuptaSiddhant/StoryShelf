import { createShelfLogger } from "@storyshelf/core/logger";
import { ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { assetManifest } from "../../asset-manifest.ts";
import { createShelfApp } from "../../index.tsx";

type Db = ReturnType<typeof makeDatabase>["db"];

async function page(
  path: string,
  seed?: (db: Db) => Promise<void>,
  ui?: Record<string, unknown>,
): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await seed?.(db);
  const app = createShelfApp({
    database: db,
    storage,
    ...(ui ? { ui } : {}),
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

describe("brand mark", () => {
  it("links the bundled mark as the favicon", async () => {
    const html = await page("/projects");
    expect(html).toContain(
      `<link rel="icon" type="image/svg+xml" href="${assetManifest.mark.href}"/>`,
    );
  });

  it("keeps the enforced favicon even when ui.favicon is supplied", async () => {
    const html = await page("/projects", undefined, { favicon: "https://acme.test/brand.ico" });
    expect(html).toContain(`href="${assetManifest.mark.href}"`);
    expect(html).not.toContain("brand.ico");
  });

  it("falls back to the mark as the sidebar logo", async () => {
    const html = await page("/projects");
    expect(html).toContain(`<img class="sidebar__logo" src="${assetManifest.mark.href}"`);
  });

  it("lets ui.logo override the sidebar logo", async () => {
    const html = await page("/projects", undefined, { logo: "https://acme.test/logo.svg" });
    expect(html).toContain('src="https://acme.test/logo.svg"');
    expect(html).not.toContain(`<img class="sidebar__logo" src="${assetManifest.mark.href}"`);
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

  it("labels the picker for assistive tech even though phones show only its icon", async () => {
    const html = await page("/projects/alpha/builds", twoProjects);
    expect(bar(html)).toContain('aria-label="Project: Alpha"');
    expect(bar(html)).toContain('class="topbar__picker"');
  });

  it("keeps the picker chevron on phones when there are several projects, drops it for one", async () => {
    const many = await page("/projects/alpha/builds", twoProjects);
    const one = await page("/projects/solo/builds", async (db) => {
      await new ProjectModel(db).create({ name: "Solo" });
    });
    expect(bar(many)).not.toContain("data-single");
    expect(bar(one)).toContain('data-single="true"');
  });

  it("reads 'All projects' on global pages with no breadcrumb", async () => {
    const projects = await page("/projects");
    const admin = await page("/admin");
    expect(projects).toContain('aria-label="Project: All projects"');
    expect(projects).not.toContain('aria-label="Breadcrumb"');
    expect(admin).not.toContain('aria-label="Breadcrumb"');
  });
});
