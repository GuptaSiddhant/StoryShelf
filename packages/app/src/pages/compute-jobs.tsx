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
import { Badge, Button, EmptyState, Meta, statusTone } from "../ui/components.tsx";
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
    <div
      class="card card--padded"
      id="active-queue"
      hx-get={`/projects/${slug}/jobs?partial=queue`}
      hx-trigger="every 5s"
      hx-swap="outerHTML"
      hx-target="#active-queue"
    >
      <h2 style="margin:0 0 .5rem;">Active queue</h2>
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
    </div>
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
      <div class="page-header">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <a href="/projects">Projects</a>
            </li>
            <li>
              <a href={`/projects/${project.slug}/builds`}>{project.name}</a>
            </li>
            <li>
              <span aria-current="page">Compute jobs</span>
            </li>
          </ol>
        </nav>
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">Compute jobs</h1>
            <p class="page-header__desc">
              Capture jobs run on this server. Queued and running jobs refresh live; recent history
              is below.
            </p>
          </div>
          <div class="page-header__actions">
            <Button variant="secondary" href={`/projects/${project.slug}/builds`}>
              Back to builds
            </Button>
          </div>
        </div>
      </div>

      {renderActiveQueue(project.slug, queueView)}

      <div class="card card--padded">
        <h2 style="margin:0 0 .3rem;">Recent builds</h2>
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
                    <div style="font-weight:600;">{build.gitBranch}</div>
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
                  <td style="white-space:nowrap;">
                    <Button
                      variant="secondary"
                      href={`/projects/${project.slug}/builds/${build.id}`}
                    >
                      View
                    </Button>
                    {canRetry && (build.status === "failed" || build.status === "pending") ? (
                      <>
                        <span style="margin-left:.35rem;" />
                        <form
                          method="post"
                          action={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`}
                          hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`}
                          hx-target="body"
                          style="display:inline;"
                        >
                          <Button variant="ghost" type="submit">
                            Retry
                          </Button>
                        </form>
                      </>
                    ) : null}
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
      </div>
    </DocumentLayout>
  );
}
