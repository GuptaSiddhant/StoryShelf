import { Button, Card, HStack, Meta, SectionTitle, VStack } from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/** Landing hero card: card surface with centered marketing padding. */
const heroCard = css`
  /* hero-card */
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 2rem 1.5rem;
  text-align: center;
`;

/** Landing hero title. Centering comes from the card. */
const heroTitle = css`
  /* hero-title */
  margin: 0 0 0.4rem;
  font-size: 1.9rem;
  letter-spacing: -0.02em;
`;

/** Landing hero description. Centering comes from the card. */
const heroDesc = css`
  /* hero-desc */
  color: var(--text-secondary);
  max-width: 60ch;
  margin: 0 auto 1rem;
`;

/** Landing page introducing capture, diff, and review. */
export function renderRootPage(): RenderedContent {
  return (
    <DocumentLayout title="Welcome" nav={{ active: "projects" }}>
      <div class={heroCard}>
        <h1 class={heroTitle}>Welcome to StoryShelf</h1>
        <p class={heroDesc}>
          Self-hosted visual testing for Storybook. Capture every story, diff against baselines, and
          review changes before they ship.
        </p>
        <VStack>
          <HStack justify="center">
            <Button variant="primary" href="/projects">
              View projects
            </Button>
            <Button variant="secondary" href="/projects/new">
              Create project
            </Button>
          </HStack>
          <Meta>
            Tip: use{" "}
            <code>
              npx storyshelf create --url &lt;url&gt; --name &lt;name&gt; --token
              $STORYSHELF_ADMIN_TOKEN
            </code>{" "}
            to create a project and token for CI, or <code>npx storyshelf init</code> to write{" "}
            <code>.storybook/storyshelf.json</code>.
          </Meta>
        </VStack>
      </div>

      <div class="grid grid--3 mt-1">
        <Card>
          <SectionTitle level={3}>Capture</SectionTitle>
          <Meta>
            Upload your Storybook build. Server renders stories with Playwright — deterministic, no
            repo cloning.
          </Meta>
        </Card>
        <Card>
          <SectionTitle level={3}>Diff</SectionTitle>
          <Meta>
            Pixel-perfect diff with pixelmatch. Configurable thresholds, overlay images stored on
            disk.
          </Meta>
        </Card>
        <Card>
          <SectionTitle level={3}>Review</SectionTitle>
          <Meta>
            Per-branch baselines with fallback to default. Approve changes per-story or bulk.
          </Meta>
        </Card>
      </div>
    </DocumentLayout>
  );
}
