import { parseTestResults } from "@storyshelf/core/capture";
import type { Build } from "@storyshelf/core/schema";
import type { Comment } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { InsightPanelData } from "../insights/panel.ts";
import type { BaselineReference, DefaultComparison } from "../routers/baseline-reference.ts";
import { DocumentLayout, type NavConfig, type RenderedContent } from "../shell/document.tsx";
import { Alert, EmptyState, type ImageSize } from "../ui/components.tsx";
import { canvasColumn, comparisonCard, workspace } from "../ui/styles/review-layout.ts";
import { a11ySummaryOf } from "./a11y-violations.tsx";
import { BuildDetails, ReviewOnlySection, type BuildDetailsData } from "./build-detail.tsx";
import { DiffActionBar } from "./build-diff-actions.tsx";
import { DiffComments } from "./build-diff-comments.tsx";
import { ReviewNotices } from "./build-diff-environment.tsx";
import { DiffHeader } from "./build-diff-header.tsx";
import { InsightSlot } from "./build-diff-insight.tsx";
import { REVIEW_CANVAS_ID, groupOf, reviewProgress } from "./build-diff-model.ts";
import { DiffNav } from "./build-diff-nav.tsx";
import { ShortcutsDialog } from "./build-diff-shortcuts.tsx";
import type { LinkedUsageItem } from "./build-diff-usage.tsx";
import { DiffViewer } from "./build-diff-viewer.tsx";
import type { DesignItem } from "./design-links.tsx";

/** Data required to render the three-up build diff review page. */
export interface BuildDiffData {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  comments: Comment[];
  selectedId?: string;
  canReview: boolean;
  /** Whether the viewer may retry or cancel the build; omitted, the header hides the menu. */
  canManage?: boolean;
  /** Whether the viewer may resolve and reopen comments. */
  canTriage: boolean;
  /** Display names of the users behind comments, by user id. */
  names: ReadonlyMap<string, string>;
  hasBaseline: Record<string, boolean>;
  reference?: BaselineReference;
  defaultComparison?: DefaultComparison | null;
  /** Open snapshots whose baseline changed after their diff was computed. */
  drifted: Record<string, "stale" | "removed">;
  /** AI triage panel data; omitted/null hides the panel. */
  insight?: InsightPanelData | null;
  /** Linked packages the selected snapshot's story uses; omitted/empty hides the badges. */
  usage?: LinkedUsageItem[];
  /** Design links the selected snapshot's component resolves to; omitted/empty hides the strip. */
  design?: DesignItem[];
  /** Base domain for published Storybook deep links. */
  publishedBaseDomain?: string;
  /** Details panel data; omitted, the page shows the review stage alone. */
  details?: BuildDetailsData;
  /** Natural size of the selected snapshot's screenshot, read from its PNG header. */
  currentSize?: ImageSize | null;
}
/** What the review stage renders: the page data with the selected snapshot resolved. */
export interface DiffReviewGridProps {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  comments: Comment[];
  selected?: Snapshot;
  canReview: boolean;
  /** Whether the viewer may resolve and reopen comments. */
  canTriage: boolean;
  /** Display names of the users behind comments, by user id. */
  names: ReadonlyMap<string, string>;
  hasBaseline: Record<string, boolean>;
  reference?: BaselineReference;
  defaultComparison?: DefaultComparison | null;
  drifted: Record<string, "stale" | "removed">;
  usage: LinkedUsageItem[];
  design: DesignItem[];
  publishedBaseDomain?: string;
  currentSize?: ImageSize | null;
}

/** The snapshot the review page shows: the requested one, else the first needing review. */
export function selectedSnapshot(snapshots: Snapshot[], selectedId?: string): Snapshot | undefined {
  return (
    snapshots.find((s) => s.id === selectedId) ??
    snapshots.find((s) => s.status === "changed" || s.status === "new") ??
    snapshots[0]
  );
}

/** The comment thread of the selected snapshot; none while the project has review off. */
function SnapshotComments(props: {
  grid: DiffReviewGridProps;
  selected: Snapshot;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { grid, selected } = props;
  return grid.project.reviewEnabled === false ? null : (
    <DiffComments
      project={grid.project}
      build={grid.build}
      selectedId={selected.id}
      selectedStoryId={selected.storyId}
      comments={grid.comments}
      canTriage={grid.canTriage}
      names={grid.names}
    />
  );
}

/** "Every change reviewed", once a build with changes has nothing left open. */
function DoneNotice(props: {
  snapshots: Snapshot[];
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const progress = reviewProgress(props.snapshots);
  if (progress.reviewable === 0 || progress.pending > 0) {
    return null;
  }
  return (
    <Alert tone="success" role="status" title="Review complete">
      {progress.reviewable === 1
        ? "The one change in this build is reviewed."
        : `All ${progress.reviewable} changes in this build are reviewed.`}
    </Alert>
  );
}

/**
 * The viewer, comments and action bar of the selected snapshot. Approve and reject swap this
 * column in place (`renderReviewSwap`), so it keeps one id across renders.
 */
export function ReviewCanvas(
  props: DiffReviewGridProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, selected, canReview, hasBaseline, drifted } = props;
  return (
    <div class={canvasColumn} id={REVIEW_CANVAS_ID}>
      {selected ? (
        <>
          <DoneNotice snapshots={snapshots} />
          {/* The comparison card: the action bar is its footer, docked while the card is in view. */}
          <div class={comparisonCard}>
            <DiffViewer
              project={project}
              build={build}
              selected={selected}
              siblings={groupOf(snapshots, selected.id)?.members}
              hasBaseline={hasBaseline}
              reference={props.reference}
              defaultComparison={props.defaultComparison}
              drifted={drifted[selected.id]}
              usage={props.usage}
              design={props.design}
              publishedBaseDomain={props.publishedBaseDomain}
              currentSize={props.currentSize}
            />
            <DiffActionBar
              project={project}
              build={build}
              snapshots={snapshots}
              selected={selected}
              canReview={canReview}
              drifted={drifted}
            />
          </div>
          <SnapshotComments grid={props} selected={selected} />
        </>
      ) : (
        <EmptyState description="Select a snapshot to review." />
      )}
    </div>
  );
}

/** Snapshot nav plus the viewer/comments column for the selected snapshot. */
function DiffReviewGrid(
  props: DiffReviewGridProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, selected } = props;
  return (
    <div class={workspace}>
      <DiffNav project={project} build={build} snapshots={snapshots} selectedId={selected?.id} />
      <ReviewCanvas {...props} />
    </div>
  );
}

/** Sidebar/breadcrumb context for the review page: Builds / <build> / Review. */
function reviewNav(project: Project, build: Build): NavConfig {
  return {
    active: "builds",
    sidebarDefault: "rail",
    projectSlug: project.slug,
    projectName: project.name,
    trail: [{ label: `${build.gitBranch} · ${build.gitSha.slice(0, 7)}` }],
  };
}

/** The collapsed details panel, when the page has its data. */
function DetailsPanel(props: {
  data: BuildDiffData;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { project, build, snapshots, canReview, drifted, details } = props.data;
  if (!details) {
    return null;
  }
  return (
    <div class="mb-1">
      <BuildDetails
        project={project}
        build={build}
        details={details}
        snapshotCount={snapshots.length}
        a11y={a11ySummaryOf(snapshots)}
        staleCount={Object.keys(drifted).length}
        canReview={canReview}
        tests={parseTestResults(build.testResults)}
      />
    </div>
  );
}

/** The stage: snapshots and their comparison, or the empty state; absent with capture off. */
function Stage(props: {
  data: BuildDiffData;
  selected: Snapshot | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { data, selected } = props;
  if (data.details?.testing === false) {
    return null;
  }
  return data.snapshots.length === 0 ? (
    <EmptyState
      title="No snapshots"
      description="This build has no snapshots yet. Capture may still be running."
    />
  ) : (
    <DiffReviewGrid
      {...data}
      selected={selected}
      usage={data.usage ?? []}
      design={data.design ?? []}
    />
  );
}

/** The build page: header, details panel, and the review stage with keyboard review. */
export function renderBuildDiffPage(data: BuildDiffData): RenderedContent {
  const { project, build, snapshots, selectedId, canReview, drifted } = data;
  const selected = selectedSnapshot(snapshots, selectedId);
  const pendingGroups = reviewProgress(snapshots).pending;
  return (
    <DocumentLayout
      title={`Build ${build.gitBranch}`}
      nav={reviewNav(project, build)}
      layout="wide"
    >
      <DiffHeader
        project={project}
        build={build}
        snapshots={snapshots}
        pendingCount={pendingGroups}
        canReview={canReview}
        canManage={data.canManage}
        details={data.details}
      />
      <ReviewNotices
        project={project}
        build={build}
        snapshots={snapshots}
        drifted={drifted}
        canReview={canReview}
      />
      <InsightSlot project={project} build={build} data={data.insight} />
      <DetailsPanel data={data} />
      {data.details ? <ReviewOnlySection details={data.details} /> : null}
      <Stage data={data} selected={selected} />
      <ShortcutsDialog />
    </DocumentLayout>
  );
}
