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
  Field,
  Meta,
  PageHeader,
  SelectField,
  TableActions,
  statusTone,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
/** Project builds page: filterable build history for one project. */
export async function renderProjectBuildsPage(
  slug: string,
  query: { status?: string; branch?: string } = {},
): Promise<RenderedContent | null> {
  const projects = await new ProjectModel(getStore().db, { projects: projectsTable }).list();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }
  const builds = await new BuildModel(getStore().db, {
    builds: buildsTable,
    buildLabels,
    snapshots,
  }).list(project.id, {
    status: query.status as never,
    branch: query.branch,
  });

  return (
    <DocumentLayout
      title={project.name}
      nav={{ active: "builds", projectSlug: project.slug, projectName: project.name }}
    >
      <PageHeader
        title={project.name}
        description={
          <>
            <code>{project.slug}</code> {project.gitRepository ? `· ${project.gitRepository}` : ""}{" "}
            · <Badge tone="neutral">{project.gitDefaultBranch}</Badge>
          </>
        }
        actions={
          <>
            <Button variant="secondary" href={`/projects/${project.slug}/settings`}>
              Settings
            </Button>
            <Button variant="ghost" href={`/projects/${project.slug}/builds`}>
              Refresh
            </Button>
          </>
        }
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: project.name }]}
      />

      <Card>
        <form method="get" action={`/projects/${project.slug}/builds`} class="row-actions">
          <SelectField
            label="Status"
            name="status"
            layout="inline"
            value={query.status ?? ""}
            options={[
              { value: "", label: "All" },
              { value: "pending", label: "pending" },
              { value: "reviewing", label: "reviewing" },
              { value: "approved", label: "approved" },
              { value: "rejected", label: "rejected" },
              { value: "failed", label: "failed" },
            ]}
          />
          <Field
            label="Branch"
            name="branch"
            layout="inline"
            value={query.branch ?? ""}
            placeholder="main"
          />
          <Button variant="secondary" type="submit">
            Filter
          </Button>
          {query.status || query.branch ? (
            <Button variant="ghost" href={`/projects/${project.slug}/builds`}>
              Clear
            </Button>
          ) : null}
        </form>
      </Card>

      {builds.length === 0 ? (
        <EmptyState
          title="No builds"
          description={
            query.status || query.branch
              ? "No builds match the current filter."
              : "Upload your first build with the CLI. Builds appear here once uploaded."
          }
        />
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Branch / SHA</th>
                <th>Status</th>
                <th>Snapshots</th>
                <th>Author</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {builds.map((build): HtmlEscapedString | Promise<HtmlEscapedString> => (
                <tr key={build.id}>
                  <td>
                    <strong>{build.gitBranch}</strong>
                    <Meta as="div">
                      {build.gitSha.slice(0, 7)}{" "}
                      {build.message ? `· ${build.message.slice(0, 60)}` : ""}
                    </Meta>
                  </td>
                  <td>
                    <Badge tone={statusTone(build.status)}>{build.status}</Badge>
                  </td>
                  <td>
                    <Meta as="span">
                      {build.changedCount} changed · {build.approvedCount} approved ·{" "}
                      {build.snapshotCount} total
                    </Meta>
                  </td>
                  <td>
                    <div>{build.authorName ?? "—"}</div>
                    <Meta as="div">{build.authorEmail ?? ""}</Meta>
                  </td>
                  <td>
                    <Meta as="span">{new Date(build.createdAt).toLocaleString()}</Meta>
                  </td>
                  <td class="nowrap">
                    <TableActions>
                      <Button
                        variant="secondary"
                        size="sm"
                        href={`/projects/${project.slug}/builds/${build.id}`}
                      >
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        href={`/projects/${project.slug}/builds/${build.id}/diff`}
                      >
                        Review
                      </Button>
                    </TableActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DocumentLayout>
  );
}
