import { BuildModel } from "../models/build.ts";
import { CommentModel } from "../models/comment.ts";
import { ProjectModel } from "../models/project.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { getStore } from "../store.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { Badge, statusTone } from "../ui/components.tsx";

export async function renderBuildDetailPage(buildId: string): Promise<RenderedContent | null> {
  const db = getStore().db;
  const build = await new BuildModel(db).get(buildId);
  if (!build) {
    return null;
  }
  const project = await new ProjectModel(db).get(build.projectId);
  if (!project) {
    return null;
  }
  const snapshots = await new SnapshotModel(db).listByBuild(build.id);
  const comments = await new CommentModel(db).listByBuild(build.id);
  const canReview = !getStore().authEnabled || Boolean(getStore().user);

  const grouped = new Map<string, typeof snapshots>();
  for (const snap of snapshots) {
    const key = snap.status;
    const list = grouped.get(key) ?? [];
    list.push(snap);
    grouped.set(key, list);
  }

  return (
    <DocumentLayout title={`Build ${build.gitBranch}`} nav={{ active: "builds", projectSlug: project.slug, projectName: project.name }}>
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
              {build.gitBranch} <span style="color:var(--text-secondary); font-weight:400;">· {build.gitSha.slice(0, 7)}</span> <Badge tone={statusTone(build.status)}>{build.status}</Badge>
            </h1>
            <p class="page-header__desc">
              {build.message ?? "No commit message"} {build.authorName ? `· ${build.authorName}${build.authorEmail ? ` <${build.authorEmail}>` : ""}` : ""} · {new Date(build.createdAt).toLocaleString()}
            </p>
          </div>
          <div class="page-header__actions">
            <a class="btn btn--primary" href={`/projects/${project.slug}/builds/${build.id}/diff`}>
              Review diffs
            </a>
            <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`} hx-target="body">
              <button class="btn btn--secondary" type="submit">
                Retry capture
              </button>
            </form>
          </div>
        </div>
      </div>

      <div class="grid grid--3" style="margin-bottom:1rem;">
        <div class="card card--padded stat">
          <div class="stat__value">{snapshots.length}</div>
          <div class="stat__label">Snapshots</div>
        </div>
        <div class="card card--padded stat">
          <div class="stat__value" style="color: var(--status-new);">
            {build.changedCount}
          </div>
          <div class="stat__label">Changed / new</div>
        </div>
        <div class="card card--padded stat">
          <div class="stat__value" style="color: var(--status-approved);">
            {build.approvedCount}
          </div>
          <div class="stat__label">Approved / unchanged</div>
        </div>
      </div>

      {canReview && (build.status === "reviewing" || build.status === "comparing") ? (
        <div class="card card--padded" style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; margin-bottom:1rem;">
          <span class="field__hint">Bulk actions:</span>
          <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`} hx-target="body">
            <button class="btn btn--primary" type="submit">
              Approve all
            </button>
          </form>
          <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`} hx-target="body">
            <button class="btn btn--danger" type="submit">
              Reject all
            </button>
          </form>
          <span class="field__hint">Or review individually in the diff view.</span>
        </div>
      ) : null}

      {snapshots.length === 0 ? (
        <div class="empty">
          <h2 class="empty__title">No snapshots yet</h2>
          <p class="empty__desc">Capture is pending or failed. Try retrying capture.</p>
        </div>
      ) : (
        <div class="snapshot-grid">
          {snapshots.map(
            // eslint-disable-next-line promise-function-async -- JSX.Element includes Promise<HtmlEscapedString>
            (snap) => (
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
                  <span style="color:var(--text-secondary); font-weight:400;"> / {snap.storyName}</span>
                </div>
                <div class="field__hint" style="font-size:.8rem;">
                  {snap.storyId}
                  {snap.diffRatio !== null && snap.diffRatio !== undefined ? ` · diff ${(snap.diffRatio * 100).toFixed(2)}%` : ""}
                  {snap.diffPixels === null ? "" : ` · ${snap.diffPixels} px`}
                </div>
                <div style="display:flex; gap:.4rem; flex-wrap:wrap; margin-top:.2rem;">
                  <a class="btn btn--secondary" href={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}>
                    Review
                  </a>
                  {canReview && (snap.status === "new" || snap.status === "changed") ? (
                    <>
                      <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/approve`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/approve`} hx-target="body">
                        <button class="btn btn--ghost" type="submit">
                          Approve
                        </button>
                      </form>
                      <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/reject`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/reject`} hx-target="body">
                        <button class="btn btn--ghost" type="submit">
                          Reject
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div class="card card--padded" style="margin-top:1rem;">
        <h2 style="margin:0 0 .5rem;">Comments</h2>
        {comments.length === 0 ? <p class="field__hint">No comments. Add one in the diff review page for a specific snapshot.</p> : null}
        <div style="display:grid; gap:.6rem;">
          {comments.map(
            // eslint-disable-next-line promise-function-async -- JSX.Element includes Promise<HtmlEscapedString>
            (comment) => (
            <div key={comment.id} class="comment">
              <div class="comment__head">
                <strong>{comment.userId}</strong>
                <span>· {new Date(comment.createdAt).toLocaleString()}</span>
                {comment.snapshotId ? <Badge tone="neutral">{snapshots.find((snapshot) => snapshot.id === comment.snapshotId)?.storyName ?? comment.snapshotId.slice(0, 6)}</Badge> : <Badge tone="neutral">build</Badge>}
                {comment.resolved ? <Badge tone="success">resolved</Badge> : null}
              </div>
              <p class="comment__body">{comment.body}</p>
            </div>
          ))}
        </div>

        <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`} hx-target="body" style="margin-top:1rem; display:grid; gap:.5rem; max-width:640px;">
          <label class="field__label" for="comment-body">
            Add build comment
          </label>
          <textarea class="field__input field__input--textarea" id="comment-body" name="body" rows={3} required placeholder="Leave a comment on this build…" />
          <div>
            <button class="btn btn--primary" type="submit">
              Comment
            </button>
          </div>
        </form>
      </div>
    </DocumentLayout>
  );
}
