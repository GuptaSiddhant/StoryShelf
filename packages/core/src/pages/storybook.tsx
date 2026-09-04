import type { Build, Project } from "../schema.ts";
import { getStore } from "../store.ts";

/**
 * Landing page for a published Storybook build. Presents the live Storybook
 * (via an iframe against the same build's statics) with the project chrome, so
 * the URL is shareable with designers/managers (ADR 0011).
 */
export function renderStorybookPage(project: Project, build: Build, slug: string): string {
  const { ui } = getStore();
  const name = ui.name ?? "StoryShelf";
  const iframeSrc = `./iframe.html`;
  return `<!doctype html>
<html lang="en" data-theme="system">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(project.name)} Storybook · ${name}</title>
    <style>
      html, body { margin: 0; height: 100%; display: flex; flex-direction: column; font-family: system-ui, sans-serif; }
      header { display: flex; align-items: center; gap: .75rem; padding: .5rem 1rem; border-bottom: 1px solid var(--border, #ddd); }
      header a { color: inherit; text-decoration: none; }
      header .crumb { opacity: .7; }
      header .branch { font-weight: 600; }
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
    </header>
    <iframe src="${escapeAttr(iframeSrc)}" title="${escapeAttr(project.name)} Storybook"></iframe>
  </body>
</html>`;
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
