import { Button, Meta } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/** Landing page introducing capture, diff, and review. */
export function renderRootPage(): RenderedContent {
  return (
    <DocumentLayout title="Welcome" nav={{ active: "projects" }}>
      <div class="card card--padded" style="text-align:center; padding:2rem 1.5rem;">
        <h1 style="margin:0 0 .4rem; font-size:1.9rem; letter-spacing:-0.02em;">
          Welcome to StoryShelf
        </h1>
        <p style="color:var(--text-secondary); max-width:60ch; margin:0 auto 1rem;">
          Self-hosted visual testing for Storybook. Capture every story, diff against baselines, and
          review changes before they ship.
        </p>
        <div class="stack">
          <div style="display:flex; gap:.5rem; justify-content:center; flex-wrap:wrap;">
            <Button variant="primary" href="/projects">
              View projects
            </Button>
            <Button variant="secondary" href="/projects/new">
              Create project
            </Button>
          </div>
          <Meta>
            Tip: use{" "}
            <code>
              npx storyshelf create --url &lt;url&gt; --name &lt;name&gt; --token
              $STORYSHELF_ADMIN_TOKEN
            </code>{" "}
            to create a project and token for CI, or <code>npx storyshelf init</code> to write{" "}
            <code>.storybook/storyshelf.json</code>.
          </Meta>
        </div>
      </div>

      <div class="grid grid--3" style="margin-top:1rem;">
        <div class="card card--padded">
          <h3 style="margin:0 0 .3rem;">Capture</h3>
          <Meta>
            Upload your Storybook build. Server renders stories with Playwright — deterministic, no
            repo cloning.
          </Meta>
        </div>
        <div class="card card--padded">
          <h3 style="margin:0 0 .3rem;">Diff</h3>
          <Meta>
            Pixel-perfect diff with pixelmatch. Configurable thresholds, overlay images stored on
            disk.
          </Meta>
        </div>
        <div class="card card--padded">
          <h3 style="margin:0 0 .3rem;">Review</h3>
          <Meta>
            Per-branch baselines with fallback to default. Approve changes per-story or bulk.
          </Meta>
        </div>
      </div>
    </DocumentLayout>
  );
}
