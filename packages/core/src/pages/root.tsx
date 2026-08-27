import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

export function renderRootPage(): RenderedContent {
  return (
    <DocumentLayout title="Welcome" nav={{ active: "projects" }}>
      <div class="card card--padded" style="text-align:center; padding:2rem 1.5rem;">
        <h1 style="margin:0 0 .4rem; font-size:1.9rem; letter-spacing:-0.02em;">Welcome to StoryShelf</h1>
        <p style="color:var(--text-secondary); max-width:60ch; margin:0 auto 1rem;">
          Self-hosted visual testing for Storybook. Capture every story, diff against baselines, and review changes before they ship.
        </p>
        <div style="display:flex; gap:.5rem; justify-content:center; flex-wrap:wrap;">
          <a class="btn btn--primary" href="/projects">
            View projects
          </a>
          <a class="btn btn--secondary" href="/projects/new">
            Create project
          </a>
        </div>
        <p class="field__hint" style="margin-top:1rem;">
          Tip: use <code>npx @storyshelf/cli init</code> to create a project and token for CI.
        </p>
      </div>

      <div class="grid grid--3" style="margin-top:1rem;">
        <div class="card card--padded">
          <h3 style="margin:0 0 .3rem;">Capture</h3>
          <p class="field__hint">Upload your Storybook build. Server renders stories with Playwright — deterministic, no repo cloning.</p>
        </div>
        <div class="card card--padded">
          <h3 style="margin:0 0 .3rem;">Diff</h3>
          <p class="field__hint">Pixel-perfect diff with pixelmatch. Configurable thresholds, overlay images stored on disk.</p>
        </div>
        <div class="card card--padded">
          <h3 style="margin:0 0 .3rem;">Review</h3>
          <p class="field__hint">Per-branch baselines with fallback to default. Approve changes per-story or bulk.</p>
        </div>
      </div>
    </DocumentLayout>
  );
}
