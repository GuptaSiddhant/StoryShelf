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
import { Badge } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
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
      <div class="page-header">
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">Projects</h1>
            <p class="page-header__desc">
              Each project is one Storybook. Create a project, then upload builds from CI.
            </p>
          </div>
          <div class="page-header__actions">
            {canCreate ? (
              <a class="btn btn--primary" href="/projects/new">
                New project
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {projects.length === 0 ? (
        <div class="empty">
          <h2 class="empty__title">No projects yet</h2>
          <p class="empty__desc">
            Create your first project to start visual testing. Projects are free and unlimited.
          </p>
          {canCreate ? (
            <div class="empty__action">
              <a class="btn btn--primary" href="/projects/new">
                Create project
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <div class="grid">
          {projects.map((project): HtmlEscapedString | Promise<HtmlEscapedString> => {
            const info = countsBySlug.get(project.slug);
            return (
              <div key={project.id} class="card card--padded">
                <div
                  class="row-actions"
                  style="justify-content:space-between; align-items:flex-start; gap:1rem;"
                >
                  <div class="truncate" style="min-width:0;">
                    <h2 class="review-bar__title">
                      <a href={`/projects/${project.slug}/builds`}>{project.name}</a>
                    </h2>
                    <p class="field__hint">
                      <code>{project.slug}</code>{" "}
                      {project.gitRepository ? `· ${project.gitRepository}` : ""} · default{" "}
                      <Badge tone="neutral">{project.gitDefaultBranch}</Badge>
                    </p>
                    {info?.latest ? (
                      <p class="field__hint">
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
                      </p>
                    ) : (
                      <p class="field__hint">No builds yet.</p>
                    )}
                  </div>
                  <div class="row-actions">
                    <a class="btn btn--secondary" href={`/projects/${project.slug}/builds`}>
                      Builds {info?.count ? `(${info.count})` : ""}
                    </a>
                    <a class="btn btn--ghost" href={`/projects/${project.slug}/settings`}>
                      Settings
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div class="card card--padded mt-1">
        <h3 class="review-bar__title">Next steps</h3>
        <ol class="muted" style="margin:.4rem 0 0; padding-left:1.2rem;">
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
      </div>
    </DocumentLayout>
  );
}
