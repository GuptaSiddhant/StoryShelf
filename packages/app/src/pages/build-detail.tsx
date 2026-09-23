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
  EmptyState,
  Meta,
  Stat,
  TextareaField,
  statusTone,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

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
              <span aria-current="page">
                {build.gitBranch} · {build.gitSha.slice(0, 7)}
              </span>
            </li>
          </ol>
        </nav>
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">
              {build.gitBranch}{" "}
              <span style="color:var(--text-secondary); font-weight:400;">
                · {build.gitSha.slice(0, 7)}
              </span>{" "}
              <Badge tone={statusTone(build.status)}>{build.status}</Badge>
            </h1>
            <p class="page-header__desc">
              {build.message ?? "No commit message"}{" "}
              {build.authorName
                ? `· ${build.authorName}${build.authorEmail ? ` <${build.authorEmail}>` : ""}`
                : ""}{" "}
              · {new Date(build.createdAt).toLocaleString()}
            </p>
          </div>
          <div class="page-header__actions">
            <Button variant="primary" href={`/projects/${project.slug}/builds/${build.id}/diff`}>
              Review diffs
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
          </div>
        </div>
      </div>

      <div class="grid grid--3" style="margin-bottom:1rem;">
        <div class="card card--padded">
          <Stat label="Snapshots" value={snapshots.length} />
        </div>
        <div class="card card--padded">
          <Stat label="Changed / new" value={build.changedCount} tone="warning" />
        </div>
        <div class="card card--padded">
          <Stat label="Approved / unchanged" value={build.approvedCount} tone="success" />
        </div>
      </div>

      {attempts.length > 0 ? (
        <div class="card card--padded">
          <h2 style="margin:0 0 .5rem;">Capture attempts</h2>
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
              <div style="display:grid; gap:.25rem; margin-top:.5rem;">
                {(attemptLogs.get(attempt.id) ?? []).map(
                  (line): HtmlEscapedString | Promise<HtmlEscapedString> => (
                    <div key={line.id} style="display:flex; gap:.4rem; align-items:baseline;">
                      <Badge tone={logTone(line.level)}>{line.level}</Badge>
                      <span>{line.message}</span>
                      {line.fields ? <Meta as="code">{line.fields}</Meta> : null}
                    </div>
                  ),
                )}
              </div>
            </details>
          ))}
        </div>
      ) : null}

      {canReview && (build.status === "reviewing" || build.status === "comparing") ? (
        <div
          class="card card--padded"
          style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; margin-bottom:1rem;"
        >
          <Meta as="span">Bulk actions:</Meta>
          <form
            method="post"
            action={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`}
            hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`}
            hx-target="body"
          >
            <Button variant="primary" type="submit">
              Approve all
            </Button>
          </form>
          <form
            method="post"
            action={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
            hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
            hx-target="body"
          >
            <Button variant="danger" type="submit">
              Reject all
            </Button>
          </form>
          <Meta as="span">Or review individually in the diff view.</Meta>
        </div>
      ) : null}

      {snapshots.length === 0 ? (
        <EmptyState
          title="No snapshots yet"
          description="Capture is pending or failed. Try retrying capture."
        />
      ) : (
        <div class="snapshot-grid">
          {snapshots.map((snap): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <div key={snap.id} class="snapshot-card">
              <div class="snapshot-card__head">
                <Badge tone={statusTone(snap.status)}>{snap.status}</Badge>
                <span class="snapshot-card__meta">
                  {snap.viewportName} · {snap.viewportWidth}×{snap.viewportHeight}
                </span>
              </div>
              <div class="snapshot-card__body">
                <div style="font-weight:650; font-size:.95rem; line-height:1.2;">
                  {snap.storyTitle}
                  <span style="color:var(--text-secondary); font-weight:400;">
                    {" "}
                    / {snap.storyName}
                  </span>
                </div>
                <Meta as="div">
                  {snap.storyId}
                  {snap.diffRatio !== null && snap.diffRatio !== undefined
                    ? ` · diff ${(snap.diffRatio * 100).toFixed(2)}%`
                    : ""}
                  {snap.diffPixels === null ? "" : ` · ${snap.diffPixels} px`}
                </Meta>
                <div style="display:flex; gap:.4rem; flex-wrap:wrap; margin-top:.2rem;">
                  <Button
                    variant="secondary"
                    href={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
                  >
                    Review
                  </Button>
                  {canReview && (snap.status === "new" || snap.status === "changed") ? (
                    <>
                      <form
                        method="post"
                        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/approve`}
                        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/approve`}
                        hx-target="body"
                      >
                        <Button variant="ghost" type="submit">
                          Approve
                        </Button>
                      </form>
                      <form
                        method="post"
                        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/reject`}
                        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/reject`}
                        hx-target="body"
                      >
                        <Button variant="ghost" type="submit">
                          Reject
                        </Button>
                      </form>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div class="card card--padded mt-1">
        <h2 style="margin:0 0 .5rem;">Comments</h2>
        {comments.length === 0 ? (
          <Meta>No comments. Add one in the diff review page for a specific snapshot.</Meta>
        ) : null}
        <div style="display:grid; gap:.6rem;">
          {comments.map((comment): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <div key={comment.id} class="comment">
              <div class="comment__head">
                <strong>{comment.userId ?? "anonymous"}</strong>
                <span>· {new Date(comment.createdAt).toLocaleString()}</span>
                {comment.snapshotId ? (
                  <Badge tone="neutral">
                    {snapshots.find((snapshot) => snapshot.id === comment.snapshotId)?.storyName ??
                      comment.snapshotId.slice(0, 6)}
                  </Badge>
                ) : (
                  <Badge tone="neutral">build</Badge>
                )}
                {comment.resolved ? <Badge tone="success">resolved</Badge> : null}
              </div>
              <p class="comment__body">{comment.body}</p>
            </div>
          ))}
        </div>

        <form
          method="post"
          action={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`}
          hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`}
          hx-target="body"
          class="stack mt-1 max-w-prose"
        >
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
        </form>
      </div>
    </DocumentLayout>
  );
}
