import type { HtmlEscapedString } from "hono/utils/html";
import type { Build } from "../schema/build.ts";
import type { Comment } from "../schema/comment.ts";
import type { Project } from "../schema/project.ts";
import type { Snapshot } from "../schema/snapshot.ts";
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
    <div class="grid" style="gap:1rem;">
      <div style="display:flex; gap:1rem; align-items:stretch;">
        <DiffNav project={project} build={build} snapshots={snapshots} selectedId={selected?.id} />
        <div style="flex:1; min-width:0; display:grid; gap:1rem;">
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
            <div class="empty">
              <p class="empty__desc">Select a snapshot to review.</p>
            </div>
          )}
        </div>
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
        <div class="empty">
          <h2 class="empty__title">No snapshots</h2>
          <p class="empty__desc">This build has no snapshots yet. Capture may still be running.</p>
        </div>
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
