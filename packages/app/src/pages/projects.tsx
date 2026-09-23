import { BuildModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import {
  buildLabels,
  builds as buildsTable,
  projects as projectsTable,
  snapshots,
} from "@storyshelf/db-sqlite/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { getStore } from "../store.ts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Meta,
  PageHeader,
  SectionTitle,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/** Next-steps list: muted with indented marker offset. */
const projectSteps = css`
  /* project-steps */
  margin: 0.4rem 0 0;
  padding-left: 1.2rem;
  color: var(--text-secondary);
`;

/** Projects overview page: project cards with latest build plus next steps. */
export async function renderProjectsPage(): Promise<RenderedContent> {
  const { db, user } = getStore();
  const projects = await new ProjectModel(db, { projects: projectsTable }).list();
  const canCreate = !user || user.role === "admin" || user.role === "member";

  const recentCounts = await Promise.all(
    projects.map(async (project) => {
      const builds = await new BuildModel(db, { builds: buildsTable, buildLabels, snapshots }).list(
        project.id,
      );
      return { slug: project.slug, count: builds.length, latest: builds[0] ?? null };
    }),
  );
  const countsBySlug = new Map(recentCounts.map((entry) => [entry.slug, entry]));

  return (
    <DocumentLayout title="Projects" nav={{ active: "projects" }}>
      <PageHeader
        title="Projects"
        description="Each project is one Storybook. Create a project, then upload builds from CI."
        actions={
          canCreate ? (
            <Button variant="primary" href="/projects/new">
              New project
            </Button>
          ) : null
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project to start visual testing. Projects are free and unlimited."
          action={
            canCreate ? (
              <Button variant="primary" href="/projects/new">
                Create project
              </Button>
            ) : null
          }
        />
      ) : (
        <div class="grid">
          {projects.map((project): HtmlEscapedString | Promise<HtmlEscapedString> => {
            const info = countsBySlug.get(project.slug);
            return (
              <Card key={project.id}>
                <div class="split">
                  <div class="truncate min-w-0">
                    <SectionTitle>
                      <a href={`/projects/${project.slug}/builds`}>{project.name}</a>
                    </SectionTitle>
                    <Meta>
                      <code>{project.slug}</code>{" "}
                      {project.gitRepository ? `· ${project.gitRepository}` : ""} · default{" "}
                      <Badge tone="neutral">{project.gitDefaultBranch}</Badge>
                    </Meta>
                    {info?.latest ? (
                      <Meta>
                        Latest: {info.latest.gitBranch} · {info.latest.gitSha.slice(0, 7)} ·{" "}
                        <Badge
                          tone={
                            info.latest.status === "approved"
                              ? "success"
                              : info.latest.status === "reviewing"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {info.latest.status}
                        </Badge>
                      </Meta>
                    ) : (
                      <Meta>No builds yet.</Meta>
                    )}
                  </div>
                  <div class="row-actions">
                    <Button variant="secondary" href={`/projects/${project.slug}/builds`}>
                      Builds {info?.count ? `(${info.count})` : ""}
                    </Button>
                    <Button variant="ghost" href={`/projects/${project.slug}/settings`}>
                      Settings
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div class="mt-1">
        <Card>
          <SectionTitle level={3}>Next steps</SectionTitle>
          <ol class={projectSteps}>
            <li>
              Create a project (or run{" "}
              <code>
                npx storyshelf create --url http://localhost:3000 --name "My Storybook" --token
                $STORYSHELF_ADMIN_TOKEN
              </code>
              , or <code>init --url --slug</code> to write <code>.storybook/storyshelf.json</code>)
            </li>
            <li>
              Generate a token in <strong>Settings → Tokens</strong> and set{" "}
              <code>STORYSHELF_TOKEN</code> in CI.
            </li>
            <li>
              Upload: <code>npx storyshelf upload</code> (or <code>npx storyshelf</code> defaults to
              upload when config exists)
            </li>
          </ol>
        </Card>
      </div>
    </DocumentLayout>
  );
}
