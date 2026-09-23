import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button, Card, Meta, statusTone } from "../ui/components.tsx";

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
    <div class="row-actions">
      <form
        method="post"
        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/approve`}
        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/approve`}
        hx-target="body"
      >
        <Button
          variant="primary"
          size="sm"
          type="submit"
          data-approve
          accesskey="a"
          title="Approve (a)"
        >
          Approve
        </Button>
      </form>
      <form
        method="post"
        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/reject`}
        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${selected.id}/reject`}
        hx-target="body"
      >
        <Button
          variant="danger"
          size="sm"
          type="submit"
          data-reject
          accesskey="r"
          title="Reject (r)"
        >
          Reject
        </Button>
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
function BaselinePane(
  props: SinglePaneProps & { hasBaseline: Record<string, boolean> },
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, hasBaseline } = props;
  return (
    <div class="diff-pane" data-pane="baseline">
      <div class="diff-pane__label">
        <span>Baseline</span>
      </div>
      {hasBaseline[selected.id] ? (
        <img
          class="diff-pane__img"
          src={imageUrl(project, build, selected, "baseline")}
          alt={`Baseline for ${selected.storyTitle} / ${selected.storyName}`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div class="diff-placeholder">
          <div>
            <div>New story — no baseline yet</div>
            <Meta as="div">First capture; approve to set the baseline.</Meta>
          </div>
        </div>
      )}
    </div>
  );
}

/** Current screenshot pane. */
function CurrentPane(props: SinglePaneProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected } = props;
  return (
    <div class="diff-pane" data-pane="current">
      <div class="diff-pane__label">
        <span>Current</span>
      </div>
      <img
        class="diff-pane__img"
        src={imageUrl(project, build, selected, "image")}
        alt={`Current for ${selected.storyTitle} / ${selected.storyName}`}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

/** Diff overlay pane (or a within-threshold note). */
function DiffPane(props: SinglePaneProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected } = props;
  return (
    <div class="diff-pane" data-pane="diff">
      <div class="diff-pane__label">
        <span>Diff</span>
        {selected.diffRatio === null ? null : (
          <span class="mono">{(selected.diffRatio * 100).toFixed(1)}%</span>
        )}
      </div>
      {selected.diffPath ? (
        <img
          class="diff-pane__img"
          src={imageUrl(project, build, selected, "diff")}
          alt={`Diff for ${selected.storyTitle} / ${selected.storyName}`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div class="diff-placeholder">
          {selected.status === "unchanged" || selected.status === "approved"
            ? "No diff — within threshold"
            : "No diff yet"}
        </div>
      )}
    </div>
  );
}

/** View-mode segmented control (split / single pane). */
function ViewSwitch(): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <div class="segmented" role="group" aria-label="Diff view" data-view-switch>
      <button type="button" data-view-value="split" aria-pressed="true">
        Split
      </button>
      <button type="button" data-view-value="baseline" aria-pressed="false">
        Baseline
      </button>
      <button type="button" data-view-value="current" aria-pressed="false">
        Current
      </button>
      <button type="button" data-view-value="diff" aria-pressed="false">
        Diff
      </button>
    </div>
  );
}

/** Baseline | current | diff image panes. */
function DiffPaneGrid(props: DiffPaneGridProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, hasBaseline } = props;
  return (
    <div class="diff-grid" data-view="split">
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
    <Card>
      <div class="review-bar">
        <div>
          <h2 class="review-bar__title">
            {selected.storyTitle} — {selected.storyName}
          </h2>
          <p class="review-bar__meta">
            <span>
              {selected.viewportName} · {selected.viewportWidth}×{selected.viewportHeight}
            </span>
            <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
            {selected.diffPixels === null ? null : (
              <span class="mono">{selected.diffPixels} px</span>
            )}
          </p>
        </div>
        <div class="row-actions">
          <ViewSwitch />
          {canReview && (selected.status === "new" || selected.status === "changed") ? (
            <SnapshotActions project={project} build={build} selected={selected} />
          ) : null}
        </div>
      </div>
      <div class="stack">
        <DiffPaneGrid
          project={project}
          build={build}
          selected={selected}
          hasBaseline={hasBaseline}
        />
        <Meta>
          Keyboard: <kbd>←</kbd> <kbd>→</kbd> navigate · <kbd>a</kbd> approve · <kbd>r</kbd> reject
        </Meta>
      </div>
    </Card>
  );
}
