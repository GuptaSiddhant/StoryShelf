import type { Build, Comment, Project, Snapshot } from "../schema.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { Badge, statusTone } from "../ui/components.tsx";

export interface BuildDiffData {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  comments: Comment[];
  selectedId?: string;
  canReview: boolean;
}

export function renderBuildDiffPage(data: BuildDiffData): RenderedContent {
  const { project, build, snapshots, comments, selectedId, canReview } = data;
  const selected = snapshots.find((s) => s.id === selectedId) ?? snapshots.find((s) => s.status === "changed" || s.status === "new") ?? snapshots[0];
  const pending = snapshots.filter((s) => s.status === "new" || s.status === "changed");

  return (
    <DocumentLayout title={`Review · ${build.gitBranch}`} nav={{ active: "builds", projectSlug: project.slug, projectName: project.name }}>
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
              <a href={`/projects/${project.slug}/builds/${build.id}`}>Build {build.gitBranch}</a>
            </li>
            <li>
              <span aria-current="page">Review</span>
            </li>
          </ol>
        </nav>
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">
              {build.gitBranch} <span style="color:var(--text-secondary); font-weight:400;">· {build.gitSha.slice(0, 7)}</span>
            </h1>
            <p class="page-header__desc">
              {build.message ?? "No message"} {build.authorName ? `· ${build.authorName}` : ""} · <Badge tone={statusTone(build.status)}>{build.status}</Badge>
            </p>
          </div>
          <div class="page-header__actions">
            <a class="btn btn--secondary" href={`/projects/${project.slug}/builds/${build.id}`}>
              Build overview
            </a>
            {canReview && pending.length > 0 ? (
              <>
                <form method="post" action={`/projects/${project.slug}/builds/${build.id}/approve-all`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`} hx-target="body">
                  <button class="btn btn--primary" type="submit">
                    Approve all ({pending.length})
                  </button>
                </form>
                <form method="post" action={`/projects/${project.slug}/builds/${build.id}/reject-all`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`} hx-target="body">
                  <button class="btn btn--danger" type="submit">
                    Reject all
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div class="card card--padded" style="margin-bottom:1rem;">
        <div class="grid grid--3" style="text-align:center;">
          <div class="stat">
            <div class="stat__value">{snapshots.length}</div>
            <div class="stat__label">Snapshots</div>
          </div>
          <div class="stat">
            <div class="stat__value" style="color: var(--status-new);">
              {pending.length}
            </div>
            <div class="stat__label">Needs review</div>
          </div>
          <div class="stat">
            <div class="stat__value" style="color: var(--status-approved);">
              {build.approvedCount}
            </div>
            <div class="stat__label">Approved</div>
          </div>
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div class="empty">
          <h2 class="empty__title">No snapshots</h2>
          <p class="empty__desc">This build has no snapshots yet. Capture may still be running.</p>
        </div>
      ) : (
        <div class="grid" style="gap:1rem;">
          <div style="display:flex; gap:1rem; align-items:stretch;">
            <div style="flex: 0 0 320px; max-width: 36%; min-width: 260px;">
              <div class="card">
                <div style="padding:.6rem .75rem; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                  <strong>Snapshots</strong>
                  <span class="field__hint">{snapshots.length} total</span>
                </div>
                <div data-diff-nav data-current={selected?.id} style="max-height: 70vh; overflow:auto;">
                  {snapshots.map(
                    // eslint-disable-next-line promise-function-async -- JSX.Element includes Promise<HtmlEscapedString>
                    (snap) => (
                    <a
                      key={snap.id}
                      href={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
                      data-snapshot-link
                      data-snapshot-id={snap.id}
                      class={`snapshot-nav ${selected?.id === snap.id ? "snapshot-nav--active" : ""}`}
                      style={`display:flex; flex-direction:column; gap:.2rem; padding:.6rem .75rem; border-bottom:1px solid var(--border); text-decoration:none; color:inherit; background:${selected?.id === snap.id ? "var(--surface-muted)" : "transparent"};`}
                      hx-get={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
                      hx-target="body"
                      hx-push-url="true"
                    >
                      <span style="display:flex; gap:.4rem; align-items:center; flex-wrap:wrap;">
                        <Badge tone={statusTone(snap.status)}>{snap.status}</Badge>
                        <span style="font-weight:600; font-size:.9rem;">{snap.storyTitle} / {snap.storyName}</span>
                      </span>
                      <span class="field__hint" style="font-size:.8rem;">
                        {snap.viewportName} · {snap.viewportWidth}×{snap.viewportHeight}
                        {snap.diffRatio !== null && snap.diffRatio !== undefined ? ` · ${(snap.diffRatio * 100).toFixed(2)}%` : ""}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            </div>

            <div style="flex:1; min-width:0; display:grid; gap:1rem;">
              {selected ? (
                <>
                  <div class="card card--padded">
                    <div style="display:flex; justify-content:space-between; gap:.5rem; align-items:center; flex-wrap:wrap;">
                      <div>
                        <h2 style="margin:0; font-size:1.05rem;">
                          {selected.storyTitle} — {selected.storyName}
                        </h2>
                        <p class="field__hint" style="margin:.2rem 0 0;">
                          {selected.viewportName} · {selected.viewportWidth}×{selected.viewportHeight} · <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
                          {selected.diffPixels === null ? "" : ` · ${selected.diffPixels} px`}
                        </p>
                      </div>
                      {canReview && (selected.status === "new" || selected.status === "changed") ? (
                        <div style="display:flex; gap:.5rem;">
                          <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/approve`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/approve`} hx-target="body">
                            <button class="btn btn--primary" type="submit" accesskey="a" title="Approve (a)">
                              Approve
                            </button>
                          </form>
                          <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/reject`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/reject`} hx-target="body">
                            <button class="btn btn--danger" type="submit" accesskey="r" title="Reject (r)">
                              Reject
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </div>

                    <div class="diff-grid" style="margin-top:1rem;">
                      <div class="diff-pane">
                        <div class="diff-pane__label">Baseline</div>
                        <div style="aspect-ratio: 16/9; display:grid; place-items:center; background:var(--surface-muted); color:var(--text-secondary); font-size:.85rem;">
                          Baseline image
                          <br />
                          <span class="field__hint">/api snapshot baseline</span>
                        </div>
                      </div>
                      <div class="diff-pane">
                        <div class="diff-pane__label">Current</div>
                        <div style="aspect-ratio: 16/9; display:grid; place-items:center; background:var(--surface-muted); color:var(--text-secondary); font-size:.85rem;">
                          Current screenshot
                          <br />
                          <span class="field__hint">{selected.screenshotPath}</span>
                        </div>
                      </div>
                      <div class="diff-pane">
                        <div class="diff-pane__label">Diff {selected.diffRatio === null ? "" : `· ${(selected.diffRatio * 100).toFixed(2)}%`}</div>
                        {selected.diffPath ? (
                          <div style="aspect-ratio: 16/9; display:grid; place-items:center; background:var(--surface-muted);">
                            Diff overlay
                            <span class="field__hint">{selected.diffPath}</span>
                          </div>
                        ) : (
                          <div style="aspect-ratio: 16/9; display:grid; place-items:center; color:var(--text-secondary);">
                            {selected.status === "unchanged" || selected.status === "approved" ? "No diff — within threshold" : "No diff yet"}
                          </div>
                        )}
                      </div>
                    </div>
                    <p class="field__hint" style="margin-top:.6rem;">
                      Keyboard: <kbd>←</kbd> <kbd>→</kbd> navigate · <kbd>a</kbd> approve · <kbd>r</kbd> reject · <kbd>?</kbd> help
                    </p>
                  </div>

                  <div class="card card--padded">
                    <h3 style="margin:0 0 .5rem;">Comments</h3>
                    <div style="display:grid; gap:.75rem;">
                      {comments
                        .filter((comment) => !comment.snapshotId || comment.snapshotId === selected.id)
                        .map(
                          // eslint-disable-next-line promise-function-async -- JSX.Element includes Promise<HtmlEscapedString>
                          (comment) => (
                          <div key={comment.id} class="comment">
                            <div class="comment__head">
                              <strong>{comment.userId}</strong>
                              <span>· {new Date(comment.createdAt).toLocaleString()}</span>
                              {comment.resolved ? <Badge tone="success">resolved</Badge> : null}
                            </div>
                            <p class="comment__body">{comment.body}</p>
                            {!comment.resolved && canReview ? (
                              <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/comments/${comment.id}/resolve`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/comments/${comment.id}/resolve`} hx-target="body" style="margin-top:.5rem;">
                                <button class="btn btn--ghost" type="submit">
                                  Mark resolved
                                </button>
                              </form>
                            ) : null}
                          </div>
                        ))}
                      {comments.filter((c) => !c.snapshotId || c.snapshotId === selected.id).length === 0 ? <p class="field__hint">No comments on this snapshot.</p> : null}
                    </div>

                    <form method="post" action={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`} hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/comments`} hx-target="body" style="margin-top:1rem; display:grid; gap:.5rem;">
                      <input type="hidden" name="snapshotId" value={selected.id} />
                      <label class="field__label" for="comment-body">
                        Add comment
                      </label>
                      <textarea class="field__input field__input--textarea" id="comment-body" name="body" rows={3} required placeholder="Leave feedback on this snapshot…" />
                      <div>
                        <button class="btn btn--primary" type="submit">
                          Comment
                        </button>
                      </div>
                    </form>
                  </div>
                </>
              ) : (
                <div class="empty">
                  <p class="empty__desc">Select a snapshot to review.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </DocumentLayout>
  );
}
