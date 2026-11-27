import type { FC } from "hono/jsx";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import { Button, Card, HStack, Meta, SectionTitle, VStack } from "../ui/components.tsx";
import { css } from "../ui/css.ts";

/** Landing hero card: card surface with centered marketing padding. */
const heroCard = css`
  /* hero-card */
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: var(--space-8) var(--space-6);
  text-align: center;
`;

/** Landing hero title. Centering comes from the card. */
const heroTitle = css`
  /* hero-title */
  margin: 0 0 var(--space-2);
  font-size: var(--text-2xl);
  letter-spacing: -0.02em;
`;

/** Landing hero description. Centering comes from the card. */
const heroDesc = css`
  /* hero-desc */
  color: var(--text-secondary);
  max-width: 60ch;
  margin: 0 auto var(--space-4);
`;

/** The welcome card: the pitch, the two entry buttons and the CLI tip. */
const Hero: FC = () => (
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
          npx storyshelf create --url &lt;url&gt; --name &lt;name&gt; --token $SHELF_ADMIN_TOKEN
        </code>{" "}
        to create a project and token for CI, or <code>npx storyshelf init</code> to write{" "}
        <code>.storybook/storyshelf.json</code>.
      </Meta>
    </VStack>
  </div>
);

/** The three steps of the product: capture, diff, review. */
const Steps: FC = () => (
  <div class="grid grid--3">
    <Card>
      <SectionTitle>Capture</SectionTitle>
      <Meta>
        Upload your Storybook build. Server renders stories with Playwright — deterministic, no repo
        cloning.
      </Meta>
    </Card>
    <Card>
      <SectionTitle>Diff</SectionTitle>
      <Meta>
        Pixel-perfect diff with pixelmatch. Configurable thresholds, overlay images stored on disk.
      </Meta>
    </Card>
    <Card>
      <SectionTitle>Review</SectionTitle>
      <Meta>Per-branch baselines with fallback to default. Approve changes per-story or bulk.</Meta>
    </Card>
  </div>
);

/** Landing page introducing capture, diff, and review. */
export function renderRootPage(): RenderedContent {
  return (
    <DocumentLayout title="Welcome" nav={{ active: "projects" }}>
      <Hero />
      <Steps />
    </DocumentLayout>
  );
}
