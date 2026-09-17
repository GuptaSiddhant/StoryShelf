import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { getStore } from "../store.ts";

/**
 * Placeholder shown while a build's statics are not yet available.
 * Refreshes itself; once extraction lands, the route serves the live page.
 */
export function renderStorybookPreparingPage(project: Project, build: Build, slug: string): string {
  const { ui } = getStore();
  const name = ui.name ?? "StoryShelf";
  return `<!doctype html>
<html lang="en" data-theme="system">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="5" />
    <title>${escapeHtml(project.name)} Storybook · ${name}</title>
    <style>
      html, body { margin: 0; height: 100%; display: flex; flex-direction: column; font-family: system-ui, sans-serif; }
      header { display: flex; align-items: center; gap: .75rem; padding: .5rem 1rem; border-bottom: 1px solid var(--border, #ddd); }
      header a { color: inherit; text-decoration: none; }
      header .crumb { opacity: .7; }
      main { flex: 1; display: flex; align-items: center; justify-content: center; opacity: .7; }
    </style>
  </head>
  <body>
    <header>
      <a href="/">${name}</a>
      <span class="crumb">/</span>
      <a href="/projects/${escapeAttr(slug)}/builds">${escapeHtml(project.name)}</a>
      <span class="crumb">/</span>
      <span>${escapeHtml(build.gitBranch)}</span>
      <span class="crumb">· ${build.gitSha.slice(0, 7)}</span>
    </header>
    <main>
      <p>Preparing preview — this page refreshes automatically. <a href="/projects/${escapeAttr(slug)}/builds/${escapeAttr(build.id)}">View build status</a></p>
    </main>
  </body>
</html>`;
}
/**
 * Landing page for a published Storybook build. Presents the live Storybook
 * (via an iframe against the same build's statics) with the project chrome, so
 * the URL is shareable with designers/managers (ADR 0011).
 */
export function renderStorybookPage(
  project: Project,
  build: Build,
  slug: string,
  options?: { storyId?: string; viewMode?: "docs" },
): string {
  const { ui } = getStore();
  const name = ui.name ?? "StoryShelf";
  const iframeSrc = storybookIframeSrc(options?.storyId, options?.viewMode);
  const copyUrl = storybookCopyUrl(slug, build.id, options?.storyId, options?.viewMode);
  return `<!doctype html>
<html lang="en" data-theme="system">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(project.name)} Storybook · ${name}</title>
    <style>
      html, body { margin: 0; height: 100%; display: flex; flex-direction: column; font-family: system-ui, sans-serif; }
      header { display: flex; align-items: center; gap: .5rem; padding: .5rem 1rem; border-bottom: 1px solid var(--border, #ddd); flex-wrap: wrap; }
      header a, header button { color: inherit; text-decoration: none; }
      header .crumb { opacity: .7; }
      header .branch { font-weight: 600; }
      header .spacer { flex: 1; }
      header .actions { display: flex; gap: .5rem; align-items: center; }
      header .btn-link { padding: .35rem .6rem; border: 1px solid var(--border, #ddd); border-radius: 6px; font-size: .85rem; background: var(--surface-card, #fff); cursor: pointer; }
      iframe { flex: 1; border: 0; width: 100%; }
    </style>
  </head>
  <body>
    <header>
      <a href="/">${name}</a>
      <span class="crumb">/</span>
      <a href="/projects/${escapeAttr(slug)}/builds">${escapeHtml(project.name)}</a>
      <span class="crumb">/</span>
      <span class="branch">${escapeHtml(build.gitBranch)}</span>
      <span class="crumb">· ${build.gitSha.slice(0, 7)}</span>
      <span class="spacer"></span>
      <span class="actions">
        <a class="btn-link" href="./index.html" target="_blank" rel="noopener" title="Open full Storybook manager in new tab">View full Storybook ↗</a>
        <button class="btn-link" type="button" data-copy-url="${escapeAttr(copyUrl)}" onclick="navigator.clipboard.writeText(location.origin+this.dataset.copyUrl).then(()=>{this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy link',1500)})">Copy link</button>
      </span>
    </header>
    <iframe src="${escapeAttr(iframeSrc)}" title="${escapeAttr(project.name)} Storybook"></iframe>
  </body>
</html>`;
}

function storybookIframeSrc(storyId?: string, viewMode?: "docs"): string {
  const id = storyId?.trim() ?? "";
  if (id !== "" && /^[a-zA-Z0-9._/-]+$/u.test(id)) {
    const mode = viewMode === "docs" ? "&viewMode=docs" : "";
    return `./iframe.html?id=${encodeURIComponent(id)}${mode}`;
  }
  return "./iframe.html";
}

function storybookCopyUrl(
  slug: string,
  buildId: string,
  storyId?: string,
  viewMode?: "docs",
): string {
  const id = storyId?.trim() ?? "";
  if (id !== "" && /^[a-zA-Z0-9._/-]+$/u.test(id)) {
    const mode = viewMode === "docs" ? "&viewMode=docs" : "";
    return `/projects/${slug}/storybook/build/${buildId}/?storyId=${encodeURIComponent(id)}${mode}`;
  }
  return `/projects/${slug}/storybook/build/${buildId}/`;
}

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (ch) => {
    switch (ch) {
      case "&": {
        return "&amp;";
      }
      case "<": {
        return "&lt;";
      }
      case ">": {
        return "&gt;";
      }
      case '"': {
        return "&quot;";
      }
      default: {
        return "&#39;";
      }
    }
  });
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
