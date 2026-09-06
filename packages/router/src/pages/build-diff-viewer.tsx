import type { HtmlEscapedString } from "hono/utils/html";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import { Badge, statusTone } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Three-up viewer props for the selected snapshot. */
export interface DiffViewerProps {
  project: Project;
  build: Build;
  selected: Snapshot;
  canReview: boolean;
  hasBaseline: Record<string, boolean>;
}

function imageUrl(
  project: Project,
  build: Build,
  snapshot: Snapshot,
  kind: "image" | "diff" | "baseline",
): string {
  return `/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snapshot.id}/${kind}`;
}

interface SnapshotActionsProps {
  project: Project;
  build: Build;
  selected: Snapshot;
}

/** Approve/reject buttons for a reviewable snapshot. */
function SnapshotActions(
  props: SnapshotActionsProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected } = props;
  return (
    <div style="display:flex; gap:.5rem;">
      <form
        method="post"
        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/approve`}
        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/approve`}
        hx-target="body"
      >
        <button class="btn btn--primary" type="submit" accesskey="a" title="Approve (a)">
          Approve
        </button>
      </form>
      <form
        method="post"
        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/reject`}
        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/reject`}
        hx-target="body"
      >
        <button class="btn btn--danger" type="submit" accesskey="r" title="Reject (r)">
          Reject
        </button>
      </form>
    </div>
  );
}

interface DiffPaneGridProps {
  project: Project;
  build: Build;
  selected: Snapshot;
  hasBaseline: Record<string, boolean>;
}

interface SinglePaneProps {
  project: Project;
  build: Build;
  selected: Snapshot;
}

/** Baseline image pane (or a first-capture placeholder). */
function BaselinePane(props: SinglePaneProps & { hasBaseline: Record<string, boolean> }): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, hasBaseline } = props;
  return (
    <div class="diff-pane">
      <div class="diff-pane__label">Baseline</div>
      {hasBaseline[selected.id] ? (
        <img
          class="diff-pane__img"
          src={imageUrl(project, build, selected, "baseline")}
          alt={`Baseline for ${selected.storyTitle} / ${selected.storyName}`}
          loading="lazy"
        />
      ) : (
        <div style="aspect-ratio: 16/9; display:grid; place-items:center; background:var(--surface-muted); color:var(--text-secondary); font-size:.85rem;">
          No baseline
          <br />
          <span class="field__hint">first capture for this story</span>
        </div>
      )}
    </div>
  );
}

/** Current screenshot pane. */
function CurrentPane(props: SinglePaneProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected } = props;
  return (
    <div class="diff-pane">
      <div class="diff-pane__label">Current</div>
      <img
        class="diff-pane__img"
        src={imageUrl(project, build, selected, "image")}
        alt={`Current for ${selected.storyTitle} / ${selected.storyName}`}
        loading="lazy"
      />
    </div>
  );
}

/** Diff overlay pane (or a within-threshold note). */
function DiffPane(props: SinglePaneProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected } = props;
  return (
    <div class="diff-pane">
      <div class="diff-pane__label">
        Diff {selected.diffRatio === null ? "" : `· ${(selected.diffRatio * 100).toFixed(2)}%`}
      </div>
      {selected.diffPath ? (
        <img
          class="diff-pane__img"
          src={imageUrl(project, build, selected, "diff")}
          alt={`Diff for ${selected.storyTitle} / ${selected.storyName}`}
          loading="lazy"
        />
      ) : (
        <div style="aspect-ratio: 16/9; display:grid; place-items:center; color:var(--text-secondary);">
          {selected.status === "unchanged" || selected.status === "approved"
            ? "No diff — within threshold"
            : "No diff yet"}
        </div>
      )}
    </div>
  );
}

/** Baseline | current | diff image panes. */
function DiffPaneGrid(props: DiffPaneGridProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, hasBaseline } = props;
  return (
    <div class="diff-grid" style="margin-top:1rem;">
      <BaselinePane project={project} build={build} selected={selected} hasBaseline={hasBaseline} />
      <CurrentPane project={project} build={build} selected={selected} />
      <DiffPane project={project} build={build} selected={selected} />
    </div>
  );
}

/** Baseline | current | diff panes with approve/reject actions. */
export function DiffViewer(props: DiffViewerProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, canReview, hasBaseline } = props;
  return (
    <div class="card card--padded">
      <div style="display:flex; justify-content:space-between; gap:.5rem; align-items:center; flex-wrap:wrap;">
        <div>
          <h2 style="margin:0; font-size:1.05rem;">
            {selected.storyTitle} — {selected.storyName}
          </h2>
          <p class="field__hint" style="margin:.2rem 0 0;">
            {selected.viewportName} · {selected.viewportWidth}×{selected.viewportHeight} ·{" "}
            <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
            {selected.diffPixels === null ? "" : ` · ${selected.diffPixels} px`}
          </p>
        </div>
        {canReview && (selected.status === "new" || selected.status === "changed") ? (
          <SnapshotActions project={project} build={build} selected={selected} />
        ) : null}
      </div>
      <DiffPaneGrid project={project} build={build} selected={selected} hasBaseline={hasBaseline} />
      <p class="field__hint" style="margin-top:.6rem;">
        Keyboard: <kbd>←</kbd> <kbd>→</kbd> navigate · <kbd>a</kbd> approve · <kbd>r</kbd> reject ·{" "}
        <kbd>?</kbd> help
      </p>
    </div>
  );
}
