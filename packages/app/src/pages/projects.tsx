import { BuildModel, ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { getStore } from "../store.ts";
import {
  Button,
  Card,
  CodeBlock,
  EmptyState,
  FilterInput,
  HStack,
  Meta,
  PageHeader,
  VStack,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { ProjectCard, type ProjectSummary } from "./projects-card.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const projectGrid = css`
  /* project-grid */
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: var(--space-4);
`;

const setupSummary = css`
  /* setup-summary */
  cursor: pointer;
  font-weight: 650;
  font-size: var(--text-lg);
  letter-spacing: -0.01em;
`;

/** Latest build, a few previews, and the review backlog for one project. */
async function summarize(project: Project): Promise<ProjectSummary> {
  const { db } = getStore();
  const [latest] = await new BuildModel(db).list(project.id);
  if (!latest) {
    return { project, latest: null, previews: [], pending: 0 };
  }
  const snapshots = await new SnapshotModel(db).listByBuild(latest.id);
  const pending = snapshots.filter((snap) => snap.status === "new" || snap.status === "changed");
  const preferred = pending.length > 0 ? pending : snapshots;
  return { project, latest, previews: preferred.slice(0, 3), pending: pending.length };
}

/** Copy-ready steps to get a first build uploaded. */
function SetupGuide({ open }: { open: boolean }): ReturnType<typeof Card> {
  return (
    <Card>
      <details open={open}>
        <summary class={setupSummary}>Set up your first upload</summary>
        <VStack>
          <Meta>1. Create a project (writes .storybook/storyshelf.json for later runs).</Meta>
          <CodeBlock code='npx storyshelf create --url http://localhost:3000 --name "My Storybook" --token $STORYSHELF_ADMIN_TOKEN' />
          <Meta>
            2. Generate a token in <strong>Settings → Tokens</strong> and set it in CI.
          </Meta>
          <CodeBlock code="export STORYSHELF_TOKEN=<your token>" />
          <Meta>3. Upload your built Storybook.</Meta>
          <CodeBlock code="npx storyshelf upload" />
        </VStack>
      </details>
    </Card>
  );
}

/** Projects overview: searchable project cards with review state, plus setup help. */
export async function renderProjectsPage(): Promise<RenderedContent> {
  const { db, user, config } = getStore();
  const urls = createUrlBuilder("/", config.publishedBaseDomain);
  const projects = await new ProjectModel(db).list();
  const summaries = await Promise.all(projects.map((project) => summarize(project)));
  const canCreate = !user || user.role === "admin" || user.role === "member";
  const newProject = canCreate ? (
    <Button variant="primary" icon="plus" href={urls.projectsNew()}>
      New project
    </Button>
  ) : null;

  return (
    <DocumentLayout title="Projects" nav={{ active: "projects" }}>
      <PageHeader
        title="Projects"
        description="Each project is one Storybook. Create a project, then upload builds from CI."
        actions={newProject}
      />
      <VStack gap="lg">
        {projects.length > 1 ? (
          <HStack>
            <FilterInput label="Filter projects" placeholder="Filter projects…" />
          </HStack>
        ) : null}
        {projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create your first project to start visual testing. Projects are free and unlimited."
            action={newProject}
          />
        ) : (
          <div class={projectGrid} data-filter-scope>
            {summaries.map((summary) => (
              <ProjectCard
                key={summary.project.id}
                summary={summary}
                urls={{
                  library: urls.library(summary.project.slug),
                  settings: urls.settings(summary.project.slug),
                  storybook: urls.short(summary.project.slug),
                  review: summary.latest
                    ? urls.buildDiff(summary.project.slug, summary.latest.id)
                    : urls.library(summary.project.slug),
                }}
              />
            ))}
            <div data-filter-empty hidden>
              <Meta center>No projects match your filter.</Meta>
            </div>
          </div>
        )}
        <SetupGuide open={projects.length === 0} />
      </VStack>
    </DocumentLayout>
  );
}
