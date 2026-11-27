import type { Build, Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import type { RenderedContent } from "../shell/document.tsx";
import { PreviewDocument } from "../shell/preview-document.tsx";
import { getStore } from "../store.ts";
import { Button, EmptyState, HStack, VStack } from "../ui/components.tsx";
import { css } from "../ui/css.ts";

/** How often, and how many times, the Preparing page checks again on its own. */
const CHECK_EVERY_MS = 5000;
const CHECK_LIMIT = 60;

const bar = css`
  /* preview-bar */
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-height: var(--topbar-height);
  padding: var(--space-2) var(--space-4);
  background: var(--surface-card);
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  font-size: var(--text-base);
`;

const crumbSeparator = css`
  /* preview-crumb-separator */
  color: var(--text-secondary);
`;

const crumbLink = css`
  /* preview-crumb-link */
  color: var(--text-secondary);
  &:hover {
    color: var(--text-primary);
  }
`;

const crumbBranch = css`
  /* preview-crumb-branch */
  font-weight: var(--weight-semibold);
`;

const crumbSha = css`
  /* preview-crumb-sha */
  color: var(--text-secondary);
`;

const barActions = css`
  /* preview-bar-actions */
  margin-left: auto;
`;

const stage = css`
  /* preview-stage */
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const frame = css`
  /* preview-frame */
  flex: 1;
  width: 100%;
  border: 0;
`;

const waiting = css`
  /* preview-waiting */
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
`;

const waitingStatus = css`
  /* preview-waiting-status */
  margin: 0;
  color: var(--text-secondary);
`;

/** The bar's crumbs: product, project, branch and short sha, with the app's "›" separators. */
const Crumbs: FC<{ name: string; project: Project; build: Build; slug: string }> = ({
  name,
  project,
  build,
  slug,
}) => (
  <>
    <a class={crumbLink} href="/">
      {name}
    </a>
    <span class={crumbSeparator} aria-hidden="true">
      ›
    </span>
    <a class={crumbLink} href={`/projects/${slug}/builds`}>
      {project.name}
    </a>
    <span class={crumbSeparator} aria-hidden="true">
      ›
    </span>
    <span class={crumbBranch}>{build.gitBranch}</span>
    <code class={crumbSha}>{build.gitSha.slice(0, 7)}</code>
  </>
);

/**
 * Placeholder shown while a build's statics are not yet available.
 * It checks again on its own (pausable, capped; no meta refresh, WCAG 2.2.1) and reloads once
 * extraction lands and the route serves the live page. "Check again" works without JavaScript.
 */
export function renderStorybookPreparingPage(
  project: Project,
  build: Build,
  slug: string,
): RenderedContent {
  const name = getStore().ui.name ?? "StoryShelf";
  return (
    <PreviewDocument title={`${project.name} Storybook`}>
      <header class={bar}>
        <Crumbs name={name} project={project} build={build} slug={slug} />
      </header>
      <main class={waiting} data-preparing>
        <EmptyState
          headingLevel={1}
          title="Preparing preview"
          action={
            <VStack align="center">
              <p class={waitingStatus} id="prep-status" role="status" aria-live="polite">
                Preparing preview. This page checks again every {CHECK_EVERY_MS / 1000} seconds.
              </p>
              <HStack justify="center">
                <Button variant="secondary" size="sm" id="prep-toggle" hidden="">
                  Pause automatic check
                </Button>
                <a href="">Check again</a>
                <a href={`/projects/${slug}/builds/${build.id}`}>View build status</a>
              </HStack>
            </VStack>
          }
        />
      </main>
      <script dangerouslySetInnerHTML={{ __html: PREPARING_SCRIPT }} />
    </PreviewDocument>
  );
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

/** The copy button's click handler: copy the page's absolute link, then say so for a moment. */
const COPY_LINK_SCRIPT =
  "navigator.clipboard.writeText(location.origin+this.dataset.copyUrl).then(()=>{this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy link',1500)})";

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
): RenderedContent {
  const name = getStore().ui.name ?? "StoryShelf";
  const iframeSrc = storybookIframeSrc(options?.storyId, options?.viewMode);
  const copyUrl = storybookCopyUrl(slug, build.id, options?.storyId, options?.viewMode);
  return (
    <PreviewDocument title={`${project.name} Storybook`}>
      <header class={bar}>
        <Crumbs name={name} project={project} build={build} slug={slug} />
        <span class={barActions}>
          <HStack>
            <Button
              variant="secondary"
              size="sm"
              href="./index.html"
              target="_blank"
              rel="noopener"
              title="Open full Storybook manager in new tab"
            >
              View full Storybook ↗
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-copy-url={copyUrl}
              onclick={COPY_LINK_SCRIPT}
            >
              Copy link
            </Button>
          </HStack>
        </span>
      </header>
      <main class={stage}>
        <h1 class="visually-hidden">{project.name} Storybook</h1>
        <iframe class={frame} src={iframeSrc} title={`${project.name} Storybook`} />
      </main>
    </PreviewDocument>
  );
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
