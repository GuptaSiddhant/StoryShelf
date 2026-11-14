/**
 * The data of a build's review page (`/projects/:slug/builds/:buildId/diff`), loaded once for the
 * full page (`ui.ts`) and for the in-place swap that follows an approve or reject
 * (`review-next.ts`), so both show the same thing.
 */
import { contentHostSuffix } from "@storyshelf/core/config";
import { CommentModel, SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { loadInsightPanel } from "../insights/panel.ts";
import { loadBuildDetails } from "../pages/build-detail.tsx";
import { selectedSnapshot, type BuildDiffData } from "../pages/build-diff.tsx";
import { getStore } from "../store.ts";
import { loadBaselineView } from "./baseline-guard.ts";
import { loadBaselineReference, loadDefaultComparison } from "./baseline-reference.ts";
import { isBuildAuthor } from "./comment-triage.ts";
import { designUrlsFor, loadDesignResolutions, loadReviewDesign } from "./design.handlers.ts";
import { linkedUsageFor } from "./links.handlers.ts";
import { readPngSize } from "./png-size.ts";
import { namesOf, reviewCapabilities } from "./review-section.handlers.ts";

/** Which snapshot to show, and the page path a design link returns to. */
export interface BuildDiffView {
  snapshotId?: string;
  returnPath: string;
}

/** Everything `renderBuildDiffPage` and `renderReviewSwap` need for one build and snapshot. */
export async function loadBuildDiffData(
  c: Context,
  project: Project,
  build: Build,
  view: BuildDiffView,
): Promise<BuildDiffData> {
  const { db, user, authEnabled, config } = getStore();
  const snapshots = await new SnapshotModel(db).listByBuild(build.id);
  const comments = await new CommentModel(db).listByBuild(build.id);
  const { hasBaseline, drifted } = await loadBaselineView(project, build, snapshots);
  const canManage = (await reviewCapabilities(project)).canComment;
  const selected = selectedSnapshot(snapshots, view.snapshotId);
  const design = selected
    ? await loadReviewDesign(
        project,
        selected,
        designUrlsFor(await loadDesignResolutions(project, snapshots), selected),
        view.returnPath,
      ).catch(() => [])
    : [];
  return {
    project,
    build,
    snapshots,
    comments,
    selectedId: view.snapshotId,
    canReview: !authEnabled || Boolean(user),
    canTriage: canManage || isBuildAuthor(build),
    canManage,
    names: await namesOf(comments.flatMap((item) => [item.userId, item.resolvedBy])),
    hasBaseline,
    drifted,
    reference: selected ? await loadBaselineReference(project, build, selected) : undefined,
    defaultComparison: selected ? await loadDefaultComparison(project, build, selected) : null,
    insight: await loadInsightPanel(project, build),
    details: await loadBuildDetails(project, build),
    design,
    usage: await linkedUsageFor(c, project, build.id, selected?.storyImportPath ?? null).catch(
      () => [],
    ),
    publishedBaseDomain: contentHostSuffix(config),
    currentSize: selected ? await readPngSize(selected.screenshotPath) : null,
  };
}
