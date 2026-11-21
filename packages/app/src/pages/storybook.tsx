import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { getStore } from "../store.ts";

/** How often, and how many times, the Preparing page checks again on its own. */
const CHECK_EVERY_MS = 5000;
const CHECK_LIMIT = 60;

/**
 * Placeholder shown while a build's statics are not yet available.
 * It checks again on its own (pausable, capped; no meta refresh, WCAG 2.2.1) and reloads once
 * extraction lands and the route serves the live page. "Check again" works without JavaScript.
 */
export function renderStorybookPreparingPage(project: Project, build: Build, slug: string): string {
  const { ui } = getStore();
  const name = ui.name ?? "StoryShelf";
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
      main { flex: 1; display: flex; align-items: center; justify-content: center; opacity: .7; }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      main { flex-direction: column; gap: .5rem; text-align: center; padding: 1rem; }
      main p { margin: 0; }
      main button { font: inherit; padding: .35rem .6rem; border: 1px solid var(--border, #ddd); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
      main [hidden] { display: none; }
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
    <main data-preparing>
      <h1 class="sr-only">Preparing preview</h1>
      <p id="prep-status" role="status" aria-live="polite">Preparing preview. This page checks again every ${CHECK_EVERY_MS / 1000} seconds.</p>
      <p>
        <button type="button" id="prep-toggle" hidden>Pause automatic check</button>
        <a href="">Check again</a>
        · <a href="/projects/${escapeAttr(slug)}/builds/${escapeAttr(build.id)}">View build status</a>
      </p>
    </main>
    <script>${PREPARING_SCRIPT}</script>
  </body>
</html>`;
}
/** Polls the same URL; reloads once the answer is no longer the Preparing page. Plain text only. */
const PREPARING_SCRIPT = `(function () {
  var status = document.getElementById("prep-status");
  var toggle = document.getElementById("prep-toggle");
  if (!status || !toggle || window.__ssPreparing) return;
  window.__ssPreparing = true;
  var left = ${CHECK_LIMIT};
  var paused = false;
  var timer = null;
  function say(text) { status.textContent = text; }
  function schedule() { if (!paused && left > 0) timer = setTimeout(check, ${CHECK_EVERY_MS}); }
  function check() {
    left -= 1;
    fetch(location.href, { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        if (t.indexOf("data-preparing") === -1) { say("Ready. Loading the Storybook."); location.reload(); return; }
        if (left <= 0) { say("Still preparing. Automatic checks stopped; use Check again."); toggle.hidden = true; return; }
        schedule();
      })
      .catch(function () { if (left > 0) schedule(); else { say("Automatic checks stopped; use Check again."); toggle.hidden = true; } });
  }
  toggle.hidden = false;
  toggle.addEventListener("click", function () {
    paused = !paused;
    clearTimeout(timer);
    toggle.textContent = paused ? "Resume automatic check" : "Pause automatic check";
    say(paused ? "Automatic check paused." : "Preparing preview. Checking again shortly.");
    if (!paused) schedule();
  });
  schedule();
})();`;

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
      main { flex: 1; display: flex; flex-direction: column; min-height: 0; }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
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
      ${actionsHtml(copyUrl)}
    </header>
    <main>
      <h1 class="sr-only">${escapeHtml(project.name)} Storybook</h1>
      <iframe src="${escapeAttr(iframeSrc)}" title="${escapeAttr(project.name)} Storybook"></iframe>
    </main>
  </body>
</html>`;
}

/** The header's actions: open the full Storybook, copy this page's link. */
function actionsHtml(copyUrl: string): string {
  return `<span class="actions">
        <a class="btn-link" href="./index.html" target="_blank" rel="noopener" title="Open full Storybook manager in new tab">View full Storybook ↗</a>
        <button class="btn-link" type="button" data-copy-url="${escapeAttr(copyUrl)}" onclick="navigator.clipboard.writeText(location.origin+this.dataset.copyUrl).then(()=>{this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy link',1500)})">Copy link</button>
      </span>`;
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
