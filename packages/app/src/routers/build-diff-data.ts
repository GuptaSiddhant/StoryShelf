/**
 * The data of a build's review page (`/projects/:slug/builds/:buildId/diff`), loaded once for the
 * full page (`ui.ts`) and for the in-place swap that follows an approve or reject
 * (`review-next.ts`), so both show the same thing.
 */
import { contentHostSuffix } from "@storyshelf/core/config";
import { CommentModel, SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { loadInsightPanel } from "../insights/panel.ts";
import { loadBuildDetails } from "../pages/build-detail.tsx";
import { selectedSnapshot, type BuildDiffData } from "../pages/build-diff.tsx";
import { getStore } from "../store.ts";
import { anonymousRead, isVisitorReadable } from "./anonymous-read.ts";
import { loadBaselineView } from "./baseline-guard.ts";
import {
  loadBaselineReference,
  loadDefaultComparison,
  type BaselineReference,
} from "./baseline-reference.ts";
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

/**
 * Everything `renderBuildDiffPage` and `renderReviewSwap` need for one build and snapshot. A
 * visitor reading a public build (`anonymousRead`) gets {@link loadVisitorDiffData} instead.
 */
export async function loadBuildDiffData(
  c: Context,
  project: Project,
  build: Build,
  view: BuildDiffView,
): Promise<BuildDiffData> {
  if ((await anonymousRead(c)) === "read") {
    return await loadVisitorDiffData(project, build, view);
  }
  return await loadMemberDiffData(c, project, build, view);
}

async function loadMemberDiffData(
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

/**
 * The review page of a public build for a visitor who is not signed in (#1172), read-only by
 * construction: no capability is granted, so no review, comment, retry or settings control renders,
 * and nothing that names people or other builds is loaded. Comments, verdicts and change requests
 * (names and discussion), capture logs, AI insights, design and package links, and the current
 * default-branch comparison are left out; a reference build the visitor may not read is unnamed.
 */
async function loadVisitorDiffData(
  project: Project,
  build: Build,
  view: BuildDiffView,
): Promise<BuildDiffData> {
  const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
  const { hasBaseline, drifted } = await loadBaselineView(project, build, snapshots);
  const selected = selectedSnapshot(snapshots, view.snapshotId);
  const details = await loadBuildDetails(project, build);
  return {
    project,
    build,
    snapshots,
    comments: [],
    selectedId: view.snapshotId,
    readOnly: true,
    canReview: false,
    canTriage: false,
    canManage: false,
    names: new Map(),
    hasBaseline,
    drifted,
    reference: selected ? await visitorReference(project, build, selected) : undefined,
    defaultComparison: null,
    insight: null,
    details: { ...details, attempts: [], review: null },
    design: [],
    usage: [],
    publishedBaseDomain: contentHostSuffix(getStore().config),
    currentSize: selected ? await readPngSize(selected.screenshotPath) : null,
  };
}

/** The snapshot's reference, with its build unnamed unless a visitor may read that build too. */
async function visitorReference(
  project: Project,
  build: Build,
  selected: Snapshot,
): Promise<BaselineReference> {
  const reference = await loadBaselineReference(project, build, selected);
  if (reference.kind !== "known" || !reference.build) {
    return reference;
  }
  return isVisitorReadable(project, reference.build) ? reference : { ...reference, build: null };
}
