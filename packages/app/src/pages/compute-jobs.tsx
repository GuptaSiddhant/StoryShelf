import type { Build, Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { RenderedContent } from "../shell/document.tsx";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Meta,
  SectionTitle,
  Table,
  VStack,
  statusTone,
} from "../ui/components.tsx";

/** Build statuses the retry button of the jobs table offers. */
const RETRYABLE: ReadonlySet<string> = new Set(["failed", "cancelled", "pending"]);

export interface QueueView {
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
          <Button variant="secondary" size="sm" href={`/projects/${slug}/builds/${build.id}/diff`}>
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

/** Jobs on the Insights tab: the live capture queue plus recent build history with retry. */
export function JobsSection(props: {
  project: Project;
  builds: Build[];
  queue: QueueView[];
  canRetry: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, queue, canRetry } = props;
  const queueByBuild = new Map(queue.map((job) => [job.buildId, job]));
  return (
    <VStack>
      {renderActiveQueue(project.slug, queue)}
      <RecentBuildsCard
        project={project}
        builds={props.builds.slice(0, 20)}
        queueByBuild={queueByBuild}
        canRetry={canRetry}
      />
    </VStack>
  );
}
