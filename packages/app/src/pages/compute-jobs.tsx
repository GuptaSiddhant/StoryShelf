import { BuildModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import type { HtmlEscapedString } from "hono/utils/html";
import { getStore } from "../store.ts";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Meta,
  PageHeader,
  SectionTitle,
  Table,
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
        <Table>
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
        </Table>
      )}
    </Card>
  );
}

/**
 * A `capturing` build the in-process queue no longer tracks was cut short by a
 * restart. Remote queues are invisible to the server, so nothing is flagged there.
 */
export function isStuckCapture(status: string, tracked: boolean, inProcessQueue: boolean): boolean {
  return inProcessQueue && status === "capturing" && !tracked;
}

/** Compute jobs page: live capture queue plus recent build history with retry. */
export async function renderComputeJobsPage(
  slug: string,
  queueView: QueueView[],
  canRetry: boolean,
  inProcessQueue = false,
): Promise<RenderedContent | null> {
  const projects = await new ProjectModel(getStore().db).list();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }
  const builds = await new BuildModel(getStore().db).list(project.id);
  const recentBuilds = builds.slice(0, 20);
  const queueByBuild = new Map(queueView.map((job) => [job.buildId, job]));
  const stuck = (id: string, status: string): boolean =>
    isStuckCapture(status, queueByBuild.has(id), inProcessQueue);
  const stuckCount = recentBuilds.filter((build) => stuck(build.id, build.status)).length;

  return (
    <DocumentLayout
      title={`${project.name} · Compute jobs`}
      nav={{ active: "jobs", projectSlug: project.slug, projectName: project.name }}
    >
      <PageHeader
        title="Compute jobs"
        description="Capture jobs run on this server. Queued and running jobs refresh live; recent history is below."
        actions={
          <Button variant="secondary" href={`/projects/${project.slug}/builds`}>
            Back to builds
          </Button>
        }
      />

      {stuckCount > 0 ? (
        <Alert tone="warning" title="Interrupted captures">
          {stuckCount} build{stuckCount === 1 ? " was" : "s were"} still capturing when the server
          restarted. On startup an interrupted build is requeued once; if it is interrupted again it
          is marked failed so a crash loop cannot repeat captures. Retry a build to run it again.
        </Alert>
      ) : null}

      {renderActiveQueue(project.slug, queueView)}

      <Card>
        <SectionTitle>Recent builds</SectionTitle>
        <Meta>Capture history for {project.name}. Failed and interrupted jobs can be retried.</Meta>
        <Table>
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th>Status</th>
                <th>Snapshots</th>
                <th>Created</th>
                <th>
                  <span class="visually-hidden">Actions</span>
                </th>
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
                    <Badge
                      tone={stuck(build.id, build.status) ? "warning" : statusTone(build.status)}
                    >
                      {stuck(build.id, build.status) ? "interrupted" : build.status}
                    </Badge>
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
                      {canRetry &&
                      (build.status === "failed" ||
                        build.status === "pending" ||
                        stuck(build.id, build.status)) ? (
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
        </Table>
        {recentBuilds.length === 0 ? <EmptyState description="No builds yet." /> : null}
      </Card>
    </DocumentLayout>
  );
}
