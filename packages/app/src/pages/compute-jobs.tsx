import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
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
  Table,
  statusTone,
} from "../ui/components.tsx";

/** Build statuses the retry button of the jobs table offers. */
const RETRYABLE: ReadonlySet<string> = new Set(["failed", "cancelled", "pending"]);

interface QueueView {
  buildId: string;
  status: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

type Rendered = ReturnType<typeof Card>;

function QueueRow(props: { slug: string; job: QueueView }): Rendered {
  const { slug, job } = props;
  return (
    <tr>
      <td>
        <a href={`/projects/${slug}/builds/${job.buildId}`}>{job.buildId.slice(0, 8)}</a>
      </td>
      <td>
        <Badge tone={statusTone(job.status)}>{job.status}</Badge>
      </td>
      <td>
        <Meta as="span">{new Date(job.queuedAt).toLocaleTimeString()}</Meta>
      </td>
      <td>
        <Meta as="span">{job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : "—"}</Meta>
      </td>
    </tr>
  );
}

function QueueTable(props: { slug: string; queueView: QueueView[] }): Rendered {
  return (
    <Table label="Active queue">
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
          {props.queueView.map((job) => (
            <QueueRow key={job.buildId} slug={props.slug} job={job} />
          ))}
        </tbody>
      </table>
    </Table>
  );
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
        <QueueTable slug={slug} queueView={queueView} />
      )}
    </Card>
  );
}

function RetryForm(props: { slug: string; buildId: string }): Rendered {
  const url = `/api/v1/projects/${props.slug}/builds/${props.buildId}/retry`;
  return (
    <form method="post" action={url} hx-post={url} hx-target="body">
      <Button variant="ghost" size="sm" type="submit">
        Retry
      </Button>
    </form>
  );
}

function BuildRow(props: {
  slug: string;
  build: Build;
  canRetry: boolean;
  error?: string;
}): Rendered {
  const { slug, build, canRetry, error } = props;
  return (
    <tr>
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
          <Button variant="secondary" size="sm" href={`/projects/${slug}/builds/${build.id}`}>
            View
          </Button>
          {canRetry && RETRYABLE.has(build.status) ? (
            <RetryForm slug={slug} buildId={build.id} />
          ) : null}
        </HStack>
        {error ? (
          <Meta as="div" tone="danger">
            {error}
          </Meta>
        ) : null}
      </td>
    </tr>
  );
}

function RecentBuildsCard(props: {
  project: Project;
  builds: Build[];
  queueByBuild: Map<string, QueueView>;
  canRetry: boolean;
}): Rendered {
  const { project, builds, queueByBuild, canRetry } = props;
  return (
    <Card>
      <SectionTitle>Recent builds</SectionTitle>
      <Meta>Capture history for {project.name}. Failed jobs can be retried.</Meta>
      <Table label="Recent builds">
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
            {builds.map((build) => (
              <BuildRow
                key={build.id}
                slug={project.slug}
                build={build}
                canRetry={canRetry}
                error={queueByBuild.get(build.id)?.error}
              />
            ))}
          </tbody>
        </table>
      </Table>
      {builds.length === 0 ? <EmptyState description="No builds yet." /> : null}
    </Card>
  );
}

/** Compute jobs page: live capture queue plus recent build history with retry. */
export async function renderComputeJobsPage(
  slug: string,
  queueView: QueueView[],
  canRetry: boolean,
): Promise<RenderedContent | null> {
  const projects = await new ProjectModel(getStore().db).list();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }
  const builds = await new BuildModel(getStore().db).list(project.id);
  const queueByBuild = new Map(queueView.map((job) => [job.buildId, job]));

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

      {renderActiveQueue(project.slug, queueView)}

      <RecentBuildsCard
        project={project}
        builds={builds.slice(0, 20)}
        queueByBuild={queueByBuild}
        canRetry={canRetry}
      />
    </DocumentLayout>
  );
}
