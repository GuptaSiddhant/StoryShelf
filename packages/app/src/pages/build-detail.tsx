import { BuildModel } from "@storyshelf/core/models";
import { CaptureAttemptModel } from "@storyshelf/core/models";
import { CaptureLogModel } from "@storyshelf/core/models";
import { CommentModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { SnapshotModel } from "@storyshelf/core/models";
import {
  buildLabels,
  builds,
  captureAttempts,
  captureLogs,
  comments as commentsTable,
  projects,
  snapshots as snapshotsTable,
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
  Stat,
  TextareaField,
  VStack,
  statusTone,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import {
  reviewComment,
  reviewCommentBody,
  reviewCommentHead,
  snapshotCard,
  snapshotCardBody,
  snapshotCardHead,
  snapshotCardMeta,
  snapshotGrid,
} from "../ui/styles/review.ts";

/** Map a capture log level to its badge tone. */
function logTone(level: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (level === "error") {
    return "danger";
  }
  if (level === "warn") {
    return "warning";
  }
  if (level === "info") {
    return "info";
  }
  return "neutral";
}
/** Build overview page: snapshot grid, bulk actions, and build comments. */
export async function renderBuildDetailPage(buildId: string): Promise<RenderedContent | null> {
  const { db } = getStore();
  const build = await new BuildModel(db, { builds, buildLabels, snapshots: snapshotsTable }).get(
    buildId,
  );
  if (!build) {
    return null;
  }
  const project = await new ProjectModel(db, { projects }).get(build.projectId);
  if (!project) {
    return null;
  }
  const snapshots = await new SnapshotModel(db, { snapshots: snapshotsTable }).listByBuild(
    build.id,
  );
  const comments = await new CommentModel(db, { comments: commentsTable, projects }).listByBuild(
    build.id,
  );
  const attempts = await new CaptureAttemptModel(db, { captureAttempts }).listByBuild(build.id);
  const logs = new CaptureLogModel(db, { captureLogs });
  const attemptLogs = new Map<string, Awaited<ReturnType<typeof logs.listByAttempt>>>();
  /* oxlint-disable-next-line eslint/no-await-in-loop -- attempts are few; sequential reads keep code simple */
  for (const attempt of attempts) {
    attemptLogs.set(attempt.id, await logs.listByAttempt(attempt.id));
  }
  const canReview = !getStore().authEnabled || Boolean(getStore().user);

  const grouped = new Map<string, typeof snapshots>();
  for (const snap of snapshots) {
    const key = snap.status;
    const list = grouped.get(key) ?? [];
    list.push(snap);
    grouped.set(key, list);
  }

  return (
    <DocumentLayout
      title={`Build ${build.gitBranch}`}
      nav={{ active: "builds", projectSlug: project.slug, projectName: project.name }}
    >
      <PageHeader
        title={
          <>
            {build.gitBranch} <Meta as="span">· {build.gitSha.slice(0, 7)}</Meta>{" "}
            <Badge tone={statusTone(build.status)}>{build.status}</Badge>
          </>
        }
        description={
          <>
            {build.message ?? "No commit message"}{" "}
            {build.authorName
              ? `· ${build.authorName}${build.authorEmail ? ` <${build.authorEmail}>` : ""}`
              : ""}{" "}
            · {new Date(build.createdAt).toLocaleString()}
          </>
        }
        actions={
          <>
            <Button variant="primary" href={`/projects/${project.slug}/builds/${build.id}/diff`}>
              Review diffs
            </Button>
            <Button variant="ghost" size="sm" href={`/_/${build.id}`}>
              View Storybook
            </Button>
            <form
              method="post"
              action={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`}
              hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`}
              hx-target="body"
            >
              <Button variant="secondary" type="submit">
                Retry capture
              </Button>
            </form>
          </>
        }
        breadcrumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.slug}/builds` },
          { label: `${build.gitBranch} · ${build.gitSha.slice(0, 7)}` },
        ]}
      />

      <div class="mb-1">
        <div class="grid grid--3">
          <Card>
            <Stat label="Snapshots" value={snapshots.length} />
          </Card>
          <Card>
            <Stat label="Changed / new" value={build.changedCount} tone="warning" />
          </Card>
          <Card>
            <Stat label="Approved / unchanged" value={build.approvedCount} tone="success" />
          </Card>
        </div>
      </div>

      {attempts.length > 0 ? (
        <Card>
          <SectionTitle>Capture attempts</SectionTitle>
          {attempts.map((attempt, index): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <details key={attempt.id} open={index === attempts.length - 1}>
              <summary>
                Attempt {attempt.attemptNo}{" "}
                <Badge tone={statusTone(attempt.status)}>{attempt.status}</Badge>{" "}
                <Meta as="span">
                  {attempt.storyCount} stories
                  {attempt.reqId ? ` · ${attempt.reqId}` : ""}
                </Meta>
              </summary>
              {attempt.error ? <Meta as="pre">{attempt.error}</Meta> : null}
              <div class="mt-1">
                <VStack>
                  {(attemptLogs.get(attempt.id) ?? []).map(
                    (line): HtmlEscapedString | Promise<HtmlEscapedString> => (
                      <HStack key={line.id} align="baseline" wrap={false}>
                        <Badge tone={logTone(line.level)}>{line.level}</Badge>
                        <span>{line.message}</span>
                        {line.fields ? <Meta as="code">{line.fields}</Meta> : null}
                      </HStack>
                    ),
                  )}
                </VStack>
              </div>
            </details>
          ))}
        </Card>
      ) : null}

      {canReview && (build.status === "reviewing" || build.status === "comparing") ? (
        <div class="mb-1">
          <Card>
            <HStack>
              <Meta as="span">Bulk actions:</Meta>
              <form
                method="post"
                action={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`}
                hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`}
                hx-target="body"
              >
                <Button variant="primary" size="sm" type="submit">
                  Approve all
                </Button>
              </form>
              <form
                method="post"
                action={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
                hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
                hx-target="body"
              >
                <Button variant="danger" size="sm" type="submit">
                  Reject all
                </Button>
              </form>
              <Meta as="span">Or review individually in the diff view.</Meta>
            </HStack>
          </Card>
        </div>
      ) : null}

      {snapshots.length === 0 ? (
        <EmptyState
          title="No snapshots yet"
          description="Capture is pending or failed. Try retrying capture."
        />
      ) : (
        <div class={snapshotGrid}>
          {snapshots.map((snap): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <div key={snap.id} class={snapshotCard}>
              <div class={snapshotCardHead}>
                <Badge tone={statusTone(snap.status)}>{snap.status}</Badge>
                <span class={snapshotCardMeta}>
                  {snap.viewportName} · {snap.viewportWidth}×{snap.viewportHeight}
                </span>
              </div>
              <div class={snapshotCardBody}>
                <SectionTitle level={3}>
                  {snap.storyTitle} <Meta as="span">/ {snap.storyName}</Meta>
                </SectionTitle>
                <Meta as="div">
                  {snap.storyId}
                  {snap.diffRatio !== null && snap.diffRatio !== undefined
                    ? ` · diff ${(snap.diffRatio * 100).toFixed(2)}%`
                    : ""}
                  {snap.diffPixels === null ? "" : ` · ${snap.diffPixels} px`}
                </Meta>
                <HStack>
                  <Button
                    variant="secondary"
                    size="sm"
                    href={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
                  >
                    Review
                  </Button>
                  <Button variant="ghost" size="sm" href={`/_/${build.id}`}>
                    View Storybook
                  </Button>
                  {canReview && (snap.status === "new" || snap.status === "changed") ? (
                    <>
                      <form
                        method="post"
                        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/approve`}
                        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/approve`}
                        hx-target="body"
                      >
                        <Button variant="ghost" size="sm" type="submit">
                          Approve
                        </Button>
                      </form>
                      <form
                        method="post"
                        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/reject`}
                        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/reject`}
                        hx-target="body"
                      >
                        <Button variant="ghost" size="sm" type="submit">
                          Reject
                        </Button>
                      </form>
                    </>
                  ) : null}
                </HStack>
              </div>
            </div>
          ))}
        </div>
      )}

      <div class="mt-1">
        <Card>
          <SectionTitle>Comments</SectionTitle>
          {comments.length === 0 ? (
            <Meta>No comments. Add one in the diff review page for a specific snapshot.</Meta>
          ) : null}
          <VStack>
            {comments.map((comment): HtmlEscapedString | Promise<HtmlEscapedString> => (
              <div key={comment.id} class={reviewComment}>
                <div class={reviewCommentHead}>
                  <strong>{comment.userId ?? "anonymous"}</strong>
                  <span>· {new Date(comment.createdAt).toLocaleString()}</span>
                  {comment.snapshotId ? (
                    <Badge tone="neutral">
                      {snapshots.find((snapshot) => snapshot.id === comment.snapshotId)
                        ?.storyName ?? comment.snapshotId.slice(0, 6)}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">build</Badge>
                  )}
                  {comment.resolved ? <Badge tone="success">resolved</Badge> : null}
                </div>
                <p class={reviewCommentBody}>{comment.body}</p>
              </div>
            ))}
          </VStack>

          <form
            method="post"
            action={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`}
            hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`}
            hx-target="body"
            class="mt-1 max-w-prose"
          >
            <VStack>
              <TextareaField
                label="Add build comment"
                name="body"
                rows={3}
                required
                placeholder="Leave a comment on this build…"
              />
              <div>
                <Button variant="primary" type="submit">
                  Comment
                </Button>
              </div>
            </VStack>
          </form>
        </Card>
      </div>
    </DocumentLayout>
  );
}
