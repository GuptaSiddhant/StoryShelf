import type { Build } from "@storyshelf/core/schema";
import type { Comment } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { InsightPanelData } from "../insights/panel.ts";
import { EmptyState } from "../ui/components.tsx";
import { DocumentLayout, type NavConfig, type RenderedContent } from "../ui/document.tsx";
import { canvasColumn, workspace } from "../ui/styles/review-layout.ts";
import { DiffActionBar } from "./build-diff-actions.tsx";
import { DiffComments } from "./build-diff-comments.tsx";
import { DiffHeader } from "./build-diff-header.tsx";
import { InsightSlot } from "./build-diff-insight.tsx";
import { DiffNav } from "./build-diff-nav.tsx";
import { ShortcutsDialog } from "./build-diff-shortcuts.tsx";
import { StaleBaselineNotice } from "./build-diff-stale.tsx";
import { DiffViewer } from "./build-diff-viewer.tsx";

/** Data required to render the three-up build diff review page. */
export interface BuildDiffData {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  comments: Comment[];
  selectedId?: string;
  canReview: boolean;
  hasBaseline: Record<string, boolean>;
  /** Open snapshots whose baseline changed after their diff was computed. */
  drifted: Record<string, "stale" | "removed">;
  /** AI triage panel data; omitted/null hides the panel. */
  insight?: InsightPanelData | null;
}

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

interface DiffReviewGridProps {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  comments: Comment[];
  selected?: Snapshot;
  canReview: boolean;
  hasBaseline: Record<string, boolean>;
  drifted: Record<string, "stale" | "removed">;
}

/** Snapshot nav plus the viewer/comments column for the selected snapshot. */
function DiffReviewGrid(
  props: DiffReviewGridProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, comments, selected, canReview, hasBaseline, drifted } = props;
  return (
    <div class={workspace}>
      <DiffNav project={project} build={build} snapshots={snapshots} selectedId={selected?.id} />
      <div class={canvasColumn}>
        {selected ? (
          <>
            <DiffViewer
              project={project}
              build={build}
              selected={selected}
              hasBaseline={hasBaseline}
              drifted={drifted[selected.id]}
            />
            <DiffComments
              project={project}
              build={build}
              selectedId={selected.id}
              comments={comments}
              canReview={canReview}
            />
            <DiffActionBar
              project={project}
              build={build}
              snapshots={snapshots}
              selected={selected}
              canReview={canReview}
              drifted={drifted[selected.id] !== undefined}
            />
          </>
        ) : (
          <EmptyState description="Select a snapshot to review." />
        )}
      </div>
    </div>
  );
}

/** Sidebar/breadcrumb context for the review page: Builds / <build> / Review. */
function reviewNav(project: Project, build: Build): NavConfig {
  return {
    active: "builds",
    projectSlug: project.slug,
    projectName: project.name,
    trail: [
      {
        label: `${build.gitBranch} · ${build.gitSha.slice(0, 7)}`,
        href: `/projects/${project.slug}/builds/${build.id}`,
      },
      { label: "Review" },
    ],
  };
}

/** Three-up diff review page: baseline, current, and diff with keyboard review. */
export function renderBuildDiffPage(data: BuildDiffData): RenderedContent {
  const { project, build, snapshots, comments, selectedId, canReview, hasBaseline, drifted } = data;
  const selected =
    snapshots.find((s) => s.id === selectedId) ??
    snapshots.find((s) => s.status === "changed" || s.status === "new") ??
    snapshots[0];
  const pending = snapshots.filter((s) => s.status === "new" || s.status === "changed");

  return (
    <DocumentLayout
      title={`Review · ${build.gitBranch}`}
      nav={reviewNav(project, build)}
      layout="wide"
    >
      <DiffHeader
        project={project}
        build={build}
        snapshots={snapshots}
        pendingCount={pending.length}
        canReview={canReview}
      />

      {Object.keys(drifted).length > 0 ? (
        <StaleBaselineNotice
          project={project}
          build={build}
          staleCount={Object.keys(drifted).length}
          canReview={canReview}
        />
      ) : null}

      <InsightSlot project={project} build={build} data={data.insight} />

      {snapshots.length === 0 ? (
        <EmptyState
          title="No snapshots"
          description="This build has no snapshots yet. Capture may still be running."
        />
      ) : (
        <DiffReviewGrid
          project={project}
          build={build}
          snapshots={snapshots}
          comments={comments}
          selected={selected}
          canReview={canReview}
          hasBaseline={hasBaseline}
          drifted={drifted}
        />
      )}
      <ShortcutsDialog />
    </DocumentLayout>
  );
}
