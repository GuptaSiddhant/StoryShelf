import type { Build } from "@storyshelf/core/schema";
import type { Comment } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { EmptyState } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { DiffComments } from "./build-diff-comments.tsx";
import { DiffHeader } from "./build-diff-header.tsx";
import { DiffNav } from "./build-diff-nav.tsx";
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
}

/** Snapshot nav plus the viewer/comments column for the selected snapshot. */
function DiffReviewGrid(
  props: DiffReviewGridProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, comments, selected, canReview, hasBaseline } = props;
  return (
    <div class="review-layout">
      <DiffNav project={project} build={build} snapshots={snapshots} selectedId={selected?.id} />
      <div class="review-main">
        {selected ? (
          <>
            <DiffViewer
              project={project}
              build={build}
              selected={selected}
              canReview={canReview}
              hasBaseline={hasBaseline}
            />
            <DiffComments
              project={project}
              build={build}
              selectedId={selected.id}
              comments={comments}
              canReview={canReview}
            />
          </>
        ) : (
          <EmptyState description="Select a snapshot to review." />
        )}
      </div>
    </div>
  );
}

/** Three-up diff review page: baseline, current, and diff with keyboard review. */
export function renderBuildDiffPage(data: BuildDiffData): RenderedContent {
  const { project, build, snapshots, comments, selectedId, canReview, hasBaseline } = data;
  const selected =
    snapshots.find((s) => s.id === selectedId) ??
    snapshots.find((s) => s.status === "changed" || s.status === "new") ??
    snapshots[0];
  const pending = snapshots.filter((s) => s.status === "new" || s.status === "changed");

  return (
    <DocumentLayout
      title={`Review · ${build.gitBranch}`}
      nav={{ active: "builds", projectSlug: project.slug, projectName: project.name }}
    >
      <DiffHeader
        project={project}
        build={build}
        snapshots={snapshots}
        pendingCount={pending.length}
        canReview={canReview}
      />

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
        />
      )}
    </DocumentLayout>
  );
}
