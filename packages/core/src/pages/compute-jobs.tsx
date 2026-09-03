import type { HtmlEscapedString } from "hono/utils/html";

import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import { getStore } from "../store.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { Badge, statusTone } from "../ui/components.tsx";

interface QueueView {
  buildId: string;
  status: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export function renderActiveQueue(slug: string, queueView: QueueView[]): RenderedContent {
  return (
    <div class="card card--padded" id="active-queue" hx-get={`/projects/${slug}/jobs?partial=queue`} hx-trigger="every 5s" hx-swap="outerHTML" hx-target="#active-queue">
      <h2 style="margin:0 0 .5rem;">Active queue</h2>
      {queueView.length === 0 ? (
        <p class="field__hint">No captures are currently queued or running.</p>
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
              {queueView.map(
                (job): HtmlEscapedString => (
                  <tr key={job.buildId}>
                    <td>
                      <a href={`/projects/${slug}/builds/${job.buildId}`}>{job.buildId.slice(0, 8)}</a>
                    </td>
                    <td>
                      <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                    </td>
                    <td class="field__hint">{new Date(job.queuedAt).toLocaleTimeString()}</td>
                    <td class="field__hint">{job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : "—"}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export async function renderComputeJobsPage(slug: string, queueView: QueueView[], canRetry: boolean): Promise<RenderedContent | null> {
  const projects = await new ProjectModel(getStore().db).list();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }
  const builds = await new BuildModel(getStore().db).list(project.id);
  const recentBuilds = builds.slice(0, 20);
  const queueByBuild = new Map(queueView.map((job) => [job.buildId, job]));

  return (
    <DocumentLayout title={`${project.name} · Compute jobs`} nav={{ active: "builds", projectSlug: project.slug, projectName: project.name }}>
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
            <p class="page-header__desc">Capture jobs run on this server. Queued and running jobs refresh live; recent history is below.</p>
          </div>
          <div class="page-header__actions">
            <a class="btn btn--secondary" href={`/projects/${project.slug}/builds`}>
              Back to builds
            </a>
          </div>
        </div>
      </div>

      {renderActiveQueue(project.slug, queueView)}

      <div class="card card--padded">
        <h2 style="margin:0 0 .3rem;">Recent builds</h2>
        <p class="field__hint">Capture history for {project.name}. Failed jobs can be retried.</p>
        <div class="table-wrap" style="margin-top:.75rem;">
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
              {recentBuilds.map(
                (build): HtmlEscapedString => (
                  <tr key={build.id}>
                    <td>
                      <div style="font-weight:600;">{build.gitBranch}</div>
                      <div class="field__hint" style="font-family: ui-monospace, monospace;">
                        {build.gitSha.slice(0, 7)}
                      </div>
                    </td>
                    <td>
                      <Badge tone={statusTone(build.status)}>{build.status}</Badge>
                    </td>
                    <td class="field__hint">{build.snapshotCount} total · {build.changedCount} changed</td>
                    <td class="field__hint">{new Date(build.createdAt).toLocaleString()}</td>
                    <td style="white-space:nowrap;">
                      <a class="btn btn--secondary" href={`/projects/${project.slug}/builds/${build.id}`}>
                        View
                      </a>
                      {canRetry && (build.status === "failed" || build.status === "pending") ? (
                        <>
                          <span style="margin-left:.35rem;" />
                          <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`} hx-target="body" style="display:inline;">
                            <button class="btn btn--ghost" type="submit">
                              Retry
                            </button>
                          </form>
                        </>
                      ) : null}
                      {queueByBuild.get(build.id)?.error ? (
                        <div class="field__hint" style="margin-top:.25rem; color: var(--status-rejected);">
                          {queueByBuild.get(build.id)?.error}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {recentBuilds.length === 0 ? <p class="field__hint" style="margin-top:.5rem;">No builds yet.</p> : null}
      </div>
    </DocumentLayout>
  );
}