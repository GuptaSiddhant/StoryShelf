// oxlint-disable typescript/promise-function-async -- Hono JSX may return Promise<HtmlEscapedString>
import { BuildModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { SnapshotModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { Snapshot } from "@storyshelf/core/schema";
import {
  buildLabels,
  builds,
  projects,
  snapshots as snapshotsTable,
} from "@storyshelf/db-sqlite/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { getStore } from "../store.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/** Library page: gallery grouped by title from latest build on selected branch. */
export async function renderLibraryPage(
  slug: string,
  branch?: string,
): Promise<RenderedContent | null> {
  const { db } = getStore();
  const project = await new ProjectModel(db, { projects }).getBySlug(slug);
  if (!project) return null;
  const build = await getLibraryBuild(db, project, branch);
  if (!build) return renderEmptyLibrary(project);
  const snapshots = await new SnapshotModel(db, { snapshots: snapshotsTable }).listByBuild(
    build.id,
  );
  if (snapshots.length === 0) return renderEmptySnapshots(project, build);
  const branches = await distinctBranches(db, project.id);
  return renderLibraryGrid(project, build, snapshots, branches);
}

async function getLibraryBuild(
  db: ReturnType<typeof getStore>["db"],
  project: Project,
  branch?: string,
): Promise<Build | null> {
  const buildModel = new BuildModel(db, { builds, buildLabels, snapshots: snapshotsTable });
  const trimmed = branch?.trim();
  const target = trimmed === undefined || trimmed === "" ? project.gitDefaultBranch : trimmed;
  const byBranch = await buildModel.list(project.id, { branch: target });
  if (byBranch[0]) return byBranch[0];
  if (target !== project.gitDefaultBranch) {
    const defaults = await buildModel.list(project.id, { branch: project.gitDefaultBranch });
    if (defaults[0]) return defaults[0];
  }
  const all = await buildModel.list(project.id);
  return all[0] ?? null;
}

async function distinctBranches(
  db: ReturnType<typeof getStore>["db"],
  projectId: string,
): Promise<string[]> {
  const buildsList = await new BuildModel(db, {
    builds,
    buildLabels,
    snapshots: snapshotsTable,
  }).list(projectId);
  return [...new Set(buildsList.map((b) => b.gitBranch))].toSorted((a, b) => a.localeCompare(b));
}

function renderEmptyLibrary(project: Project): RenderedContent {
  return (
    <DocumentLayout
      title="Library"
      nav={{ active: "library", projectSlug: project.slug, projectName: project.name }}
    >
      <div class="page-header">
        <h1 class="page-header__title">Library</h1>
        <p class="page-header__desc">
          All stories/components from the latest build on {project.gitDefaultBranch}.
        </p>
      </div>
      <div class="empty">
        <h2 class="empty__title">No builds yet</h2>
        <p class="empty__desc">Upload a build to populate the library.</p>
      </div>
    </DocumentLayout>
  );
}

function renderEmptySnapshots(project: Project, build: Build): RenderedContent {
  return (
    <DocumentLayout
      title="Library"
      nav={{ active: "library", projectSlug: project.slug, projectName: project.name }}
    >
      <div class="page-header">
        <h1 class="page-header__title">Library</h1>
        <p class="page-header__desc">
          Latest build {build.gitBranch} · {build.gitSha.slice(0, 7)} · {build.status}
        </p>
      </div>
      <div class="empty">
        <h2 class="empty__title">No stories in latest build</h2>
        <p class="empty__desc">The latest build has no snapshots yet.</p>
        <a class="btn btn--secondary" href={`/projects/${project.slug}/builds/${build.id}`}>
          View build
        </a>
      </div>
    </DocumentLayout>
  );
}

function groupByTitle(snapshots: Snapshot[]): Map<string, Snapshot[]> {
  const map = new Map<string, Snapshot[]>();
  for (const snap of snapshots) {
    const key = snap.storyTitle || "Untitled";
    const list = map.get(key) ?? [];
    list.push(snap);
    map.set(key, list);
  }
  return map;
}

function distinctViewports(snapshots: Snapshot[]): string[] {
  return [...new Set(snapshots.map((s) => s.viewportName))].toSorted();
}

function renderLibraryGrid(
  project: Project,
  build: Build,
  snapshots: Snapshot[],
  branches: string[],
): RenderedContent {
  const byTitle = groupByTitle(snapshots);
  const viewportNames = distinctViewports(snapshots);
  const multi = viewportNames.length > 1;
  return (
    <DocumentLayout
      title="Library"
      nav={{ active: "library", projectSlug: project.slug, projectName: project.name }}
    >
      {renderLibraryHeader(project, build, snapshots.length, branches)}
      {multi ? (
        <div class="card card--padded" style="margin-bottom:1rem;">
          <span class="field__hint">Viewports: {viewportNames.join(" · ")}</span>
        </div>
      ) : null}
      {renderTitleList(byTitle, project, build, multi)}
    </DocumentLayout>
  );
}

function renderLibraryHeader(
  project: Project,
  build: Build,
  storyCount: number,
  branches: string[],
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <div class="page-header">
      <div class="page-header__row">
        <div>
          <h1 class="page-header__title">Library</h1>
          <p class="page-header__desc">
            {storyCount} stories · Latest build{" "}
            <a href={`/projects/${project.slug}/builds/${build.id}`}>
              {build.gitBranch} · {build.gitSha.slice(0, 7)}
            </a>{" "}
            · {new Date(build.createdAt).toLocaleString()} · {build.status}
          </p>
        </div>
        <div class="page-header__actions">{renderBranchPicker(project, build, branches)}</div>
      </div>
    </div>
  );
}

function renderBranchPicker(
  project: Project,
  build: Build,
  branches: string[],
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <form
      method="get"
      action={`/projects/${project.slug}/library`}
      style="display:flex; gap:.5rem; align-items:center;"
    >
      <label class="field__label" for="branch-picker" style="margin:0;">
        Branch
      </label>
      <select
        id="branch-picker"
        name="branch"
        class="field__input"
        style="min-height:44px; padding:.4rem .6rem;"
      >
        {branches.map((b) => (
          <option value={b} selected={b === build.gitBranch ? true : undefined}>
            {b}
          </option>
        ))}
      </select>
      <button class="btn btn--secondary" type="submit">
        View
      </button>
    </form>
  );
}

function renderTitleList(
  byTitle: Map<string, Snapshot[]>,
  project: Project,
  build: Build,
  multi: boolean,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const titles = [...byTitle.keys()].toSorted((a, b) => a.localeCompare(b));
  return (
    <div style="display:grid; gap:1.5rem;">
      {titles.map((title) =>
        renderTitleGroup(title, byTitle.get(title) ?? [], project, build, multi),
      )}
    </div>
  );
}

function renderTitleGroup(
  title: string,
  group: Snapshot[],
  project: Project,
  build: Build,
  hasMultipleViewports: boolean,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const byViewport = groupByViewport(group);
  const vNames = [...byViewport.keys()].toSorted();
  return (
    <div key={title} class="card">
      <div class="card--padded" style="border-bottom:1px solid var(--border);">
        <h2 style="margin:0; font-size:1.1rem;">{title}</h2>
        <span class="field__hint">{group.length} stories</span>
      </div>
      <div style="padding:1rem; display:grid; gap:1rem;">
        {vNames.map((vName) =>
          renderViewportGroup(
            vName,
            byViewport.get(vName) ?? [],
            project,
            build,
            hasMultipleViewports,
          ),
        )}
      </div>
    </div>
  );
}

function groupByViewport(group: Snapshot[]): Map<string, Snapshot[]> {
  const map = new Map<string, Snapshot[]>();
  for (const snap of group) {
    const list = map.get(snap.viewportName) ?? [];
    list.push(snap);
    map.set(snap.viewportName, list);
  }
  return map;
}

function renderViewportGroup(
  vName: string,
  snaps: Snapshot[],
  project: Project,
  build: Build,
  hasMultipleViewports: boolean,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <div key={vName}>
      {hasMultipleViewports ? (
        <h3 style="margin:0 0 .5rem; font-size:.9rem; color:var(--text-secondary);">{vName}</h3>
      ) : null}
      <div class="snapshot-grid">
        {snaps
          .toSorted((a, b) => a.storyName.localeCompare(b.storyName))
          .map((snap) => renderSnapshotCard(snap, project, build))}
      </div>
    </div>
  );
}

function renderSnapshotCard(
  snap: Snapshot,
  project: Project,
  build: Build,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <div key={snap.id} class="snapshot-card">
      <div class="snapshot-card__head">
        <span style="font-weight:650;">{snap.storyName}</span>
        <span class="snapshot-card__meta">
          {snap.viewportWidth}×{snap.viewportHeight}
        </span>
      </div>
      <div class="snapshot-card__body">
        <img
          class="diff-pane__img"
          src={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/image`}
          alt={`${snap.storyTitle} / ${snap.storyName}`}
          loading="lazy"
          style="max-height:240px; object-fit:contain;"
        />
        <div style="display:flex; gap:.4rem; flex-wrap:wrap;">
          <a
            class="btn btn--secondary"
            href={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
          >
            Review
          </a>
          <a
            class="btn btn--ghost"
            href={`/projects/${project.slug}/storybook/build/${build.id}/?storyId=${encodeURIComponent(snap.storyId)}`}
            target="_blank"
            rel="noopener"
          >
            Preview ↗
          </a>
        </div>
      </div>
    </div>
  );
}
