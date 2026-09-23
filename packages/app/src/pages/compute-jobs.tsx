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
  HStack,
  Meta,
  PageHeader,
  SectionTitle,
  statusTone,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
interface QueueView {
  buildId: string;
  status: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/** Live-refreshing partial showing the currently queued and running captures. */
export function renderActiveQueue(slug: string, queueView: QueueView[]): RenderedContent {
  return (
    <Card
      id="active-queue"
      hx-get={`/projects/${slug}/jobs?partial=queue`}
      hx-trigger="every 5s"
      hx-swap="outerHTML"
      hx-target="#active-queue"
    >
      <SectionTitle>Active queue</SectionTitle>
      {queueView.length === 0 ? (
        <Meta>No captures are currently queued or running.</Meta>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Build</th>
                <th>Status</th>
                <th>Queued</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {queueView.map((job): HtmlEscapedString | Promise<HtmlEscapedString> => (
                <tr key={job.buildId}>
                  <td>
                    <a href={`/projects/${slug}/builds/${job.buildId}`}>
                      {job.buildId.slice(0, 8)}
                    </a>
                  </td>
                  <td>
                    <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                  </td>
                  <td>
                    <Meta as="span">{new Date(job.queuedAt).toLocaleTimeString()}</Meta>
                  </td>
                  <td>
                    <Meta as="span">
                      {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : "—"}
                    </Meta>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Compute jobs page: live capture queue plus recent build history with retry. */
export async function renderComputeJobsPage(
  slug: string,
  queueView: QueueView[],
  canRetry: boolean,
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
  }).list(project.id);
  const recentBuilds = builds.slice(0, 20);
  const queueByBuild = new Map(queueView.map((job) => [job.buildId, job]));

  return (
    <DocumentLayout
      title={`${project.name} · Compute jobs`}
      nav={{ active: "builds", projectSlug: project.slug, projectName: project.name }}
    >
      <PageHeader
        title="Compute jobs"
        description="Capture jobs run on this server. Queued and running jobs refresh live; recent history is below."
        actions={
          <Button variant="secondary" href={`/projects/${project.slug}/builds`}>
            Back to builds
          </Button>
        }
        breadcrumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.slug}/builds` },
          { label: "Compute jobs" },
        ]}
      />

      {renderActiveQueue(project.slug, queueView)}

      <Card>
        <SectionTitle>Recent builds</SectionTitle>
        <Meta>Capture history for {project.name}. Failed jobs can be retried.</Meta>
        <div class="table-wrap table-gap">
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th>Status</th>
                <th>Snapshots</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentBuilds.map((build): HtmlEscapedString | Promise<HtmlEscapedString> => (
                <tr key={build.id}>
                  <td>
                    <strong>{build.gitBranch}</strong>
                    <Meta as="div" mono>
                      {build.gitSha.slice(0, 7)}
                    </Meta>
                  </td>
                  <td>
                    <Badge tone={statusTone(build.status)}>{build.status}</Badge>
                  </td>
                  <td>
                    <Meta as="span">
                      {build.snapshotCount} total · {build.changedCount} changed
                    </Meta>
                  </td>
                  <td>
                    <Meta as="span">{new Date(build.createdAt).toLocaleString()}</Meta>
                  </td>
                  <td class="nowrap">
                    <HStack wrap={false}>
                      <Button
                        variant="secondary"
                        size="sm"
                        href={`/projects/${project.slug}/builds/${build.id}`}
                      >
                        View
                      </Button>
                      {canRetry && (build.status === "failed" || build.status === "pending") ? (
                        <form
                          method="post"
                          action={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`}
                          hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`}
                          hx-target="body"
                        >
                          <Button variant="ghost" size="sm" type="submit">
                            Retry
                          </Button>
                        </form>
                      ) : null}
                    </HStack>
                    {queueByBuild.get(build.id)?.error ? (
                      <Meta as="div" tone="danger">
                        {queueByBuild.get(build.id)?.error}
                      </Meta>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recentBuilds.length === 0 ? <EmptyState description="No builds yet." /> : null}
      </Card>
    </DocumentLayout>
  );
}
