// oxlint-disable typescript/promise-function-async -- Hono JSX may return Promise<HtmlEscapedString>
import { BuildModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { SnapshotModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { Snapshot } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { storybookDir } from "@storyshelf/core/utils";
import type { HtmlEscapedString } from "hono/utils/html";
import { posix } from "node:path";
import { getStore } from "../store.ts";
import {
  Button,
  Card,
  CardSection,
  EmptyState,
  HStack,
  Meta,
  PageHeader,
  SectionTitle,
  SelectField,
  VStack,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import {
  diffPaneImg,
  snapshotCard,
  snapshotCardBody,
  snapshotCardHead,
  snapshotCardMeta,
  snapshotGrid,
} from "../ui/styles/review.ts";

/** Snapshot image with library height cap, extending the shared diff pane image. */
const snapshotImg = css`
  /* snapshot-img */
  ${diffPaneImg}
  max-height: 240px;
  object-fit: contain;
`;

/** Library page: gallery grouped by title from latest build on selected branch. */
export async function renderLibraryPage(
  slug: string,
  branch?: string,
): Promise<RenderedContent | null> {
  const { db, storage } = getStore();
  const project = await new ProjectModel(db, { projects: getStore().db.tables.projects }).getBySlug(
    slug,
  );
  if (!project) return null;
  const build = await getLibraryBuild(db, project, branch);
  if (!build) return renderEmptyLibrary(project);
  const snapshots = await new SnapshotModel(db, {
    snapshots: getStore().db.tables.snapshots,
  }).listByBuild(build.id);
  if (snapshots.length === 0) return renderEmptySnapshots(project, build);
  const branches = await distinctBranches(db, project.id);
  const docsByStory = await docsEntriesByStory(storage, project.id, build.id, snapshots);
  return renderLibraryGrid(project, build, snapshots, branches, docsByStory);
}

async function getLibraryBuild(
  db: ReturnType<typeof getStore>["db"],
  project: Project,
  branch?: string,
): Promise<Build | null> {
  const buildModel = new BuildModel(db, {
    builds: getStore().db.tables.builds,
    buildLabels: getStore().db.tables.buildLabels,
    snapshots: getStore().db.tables.snapshots,
  });
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
    builds: getStore().db.tables.builds,
    buildLabels: getStore().db.tables.buildLabels,
    snapshots: getStore().db.tables.snapshots,
  }).list(projectId);
  return [...new Set(buildsList.map((b) => b.gitBranch))].toSorted((a, b) => a.localeCompare(b));
}

/** Storybook index entries (only the docs subset we need). */
interface LibraryIndexEntry {
  id?: string;
  type?: string;
}

/**
 * Map snapshot story ids to their component's docs entry id. Reads the build's
 * Storybook index from storage and returns an empty map when statics are
 * purged or the build has no docs entries, so the Library never links to a
 * docs page that does not exist.
 */
async function docsEntriesByStory(
  storage: ReturnType<typeof getStore>["storage"],
  projectId: string,
  buildId: string,
  snapshots: Snapshot[],
): Promise<Map<string, string>> {
  const prefixes = await readDocsPrefixes(storage, projectId, buildId);
  const byStory = new Map<string, string>();
  for (const snap of snapshots) {
    const docsId = docsEntryId(prefixes, snap.storyId);
    if (docsId) byStory.set(snap.storyId, docsId);
  }
  return byStory;
}

async function readDocsPrefixes(
  storage: ReturnType<typeof getStore>["storage"],
  projectId: string,
  buildId: string,
): Promise<Set<string>> {
  const candidates = await Promise.all(
    ["index.json", "stories.json"].map((name) =>
      readIndexEntries(storage, projectId, buildId, name),
    ),
  );
  const prefixes = new Set<string>();
  for (const entries of candidates) {
    if (entries) {
      for (const entry of Object.values(entries)) {
        if (entry?.type === "docs" && typeof entry.id === "string" && entry.id.endsWith("--docs")) {
          prefixes.add(entry.id.slice(0, -"--docs".length));
        }
      }
      return prefixes;
    }
  }
  return prefixes;
}

async function readIndexEntries(
  storage: ReturnType<typeof getStore>["storage"],
  projectId: string,
  buildId: string,
  name: string,
): Promise<Record<string, LibraryIndexEntry> | null> {
  try {
    const raw = await storage.read(posix.join(storybookDir(projectId, buildId), name));
    const parsed = JSON.parse(raw.toString("utf8")) as {
      entries?: Record<string, LibraryIndexEntry>;
    };
    return parsed.entries ?? null;
  } catch {
    return null;
  }
}

function docsEntryId(prefixes: Set<string>, storyId: string): string | undefined {
  for (const prefix of prefixes) {
    if (storyId.startsWith(`${prefix}--`) || storyId === prefix) {
      return `${prefix}--docs`;
    }
  }
  return undefined;
}

function renderEmptyLibrary(project: Project): RenderedContent {
  return (
    <DocumentLayout
      title="Library"
      nav={{ active: "library", projectSlug: project.slug, projectName: project.name }}
    >
      <PageHeader
        title="Library"
        description={
          <>All stories/components from the latest build on {project.gitDefaultBranch}.</>
        }
      />
      <EmptyState title="No builds yet" description="Upload a build to populate the library." />
    </DocumentLayout>
  );
}

function renderEmptySnapshots(project: Project, build: Build): RenderedContent {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <DocumentLayout
      title="Library"
      nav={{ active: "library", projectSlug: project.slug, projectName: project.name }}
    >
      <PageHeader
        title="Library"
        description={
          <>
            Latest build {build.gitBranch} · {build.gitSha.slice(0, 7)} · {build.status}
          </>
        }
      />
      <EmptyState
        title="No stories in latest build"
        description="The latest build has no snapshots yet."
        action={
          <Button variant="secondary" href={urls.build(project.slug, build.id)}>
            View build
          </Button>
        }
      />
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
  docsByStory: Map<string, string>,
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
        <Card>
          <Meta as="span">Viewports: {viewportNames.join(" · ")}</Meta>
        </Card>
      ) : null}
      {renderTitleList(byTitle, project, build, multi, docsByStory)}
    </DocumentLayout>
  );
}

function renderLibraryHeader(
  project: Project,
  build: Build,
  storyCount: number,
  branches: string[],
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <PageHeader
      title="Library"
      description={
        <>
          {storyCount} stories · Latest build{" "}
          <a href={urls.build(project.slug, build.id)}>
            {build.gitBranch} · {build.gitSha.slice(0, 7)}
          </a>{" "}
          · {new Date(build.createdAt).toLocaleString()} · {build.status}
        </>
      }
      actions={
        <HStack>
          <Button variant="ghost" size="sm" href={urls.short(project.slug)}>
            View Storybook
          </Button>
          {renderBranchPicker(project, build, branches)}
        </HStack>
      }
    />
  );
}

function renderBranchPicker(
  project: Project,
  build: Build,
  branches: string[],
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <form method="get" action={`/projects/${project.slug}/library`}>
      <HStack>
        <SelectField
          label="Branch"
          name="branch"
          layout="inline"
          value={build.gitBranch}
          options={branches.map((b) => ({ value: b, label: b }))}
        />
        <Button variant="secondary" type="submit">
          View
        </Button>
      </HStack>
    </form>
  );
}

function renderTitleList(
  byTitle: Map<string, Snapshot[]>,
  project: Project,
  build: Build,
  multi: boolean,
  docsByStory: Map<string, string>,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const titles = [...byTitle.keys()].toSorted((a, b) => a.localeCompare(b));
  return (
    <VStack>
      {titles.map((title) =>
        renderTitleGroup(title, byTitle.get(title) ?? [], project, build, multi, docsByStory),
      )}
    </VStack>
  );
}

function renderTitleGroup(
  title: string,
  group: Snapshot[],
  project: Project,
  build: Build,
  hasMultipleViewports: boolean,
  docsByStory: Map<string, string>,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const byViewport = groupByViewport(group);
  const vNames = [...byViewport.keys()].toSorted();
  return (
    <Card key={title} padded={false}>
      <CardSection divider>
        <SectionTitle>{title}</SectionTitle>
        <Meta as="span">{group.length} stories</Meta>
      </CardSection>
      <CardSection>
        <VStack>
          {vNames.map((vName) =>
            renderViewportGroup(
              vName,
              byViewport.get(vName) ?? [],
              project,
              build,
              hasMultipleViewports,
              docsByStory,
            ),
          )}
        </VStack>
      </CardSection>
    </Card>
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
  docsByStory: Map<string, string>,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <div key={vName}>
      {hasMultipleViewports ? <SectionTitle level={3}>{vName}</SectionTitle> : null}
      <div class={snapshotGrid}>
        {snaps
          .toSorted((a, b) => a.storyName.localeCompare(b.storyName))
          .map((snap) => renderSnapshotCard(snap, project, build, docsByStory))}
      </div>
    </div>
  );
}

function renderSnapshotCard(
  snap: Snapshot,
  project: Project,
  build: Build,
  docsByStory: Map<string, string>,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const docsId = docsByStory.get(snap.storyId);
  return (
    <div key={snap.id} class={snapshotCard}>
      <div class={snapshotCardHead}>
        <strong>{snap.storyName}</strong>
        <span class={snapshotCardMeta}>
          {snap.viewportWidth}×{snap.viewportHeight}
        </span>
      </div>
      <div class={snapshotCardBody}>
        <img
          class={snapshotImg}
          src={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/image`}
          alt={`${snap.storyTitle} / ${snap.storyName}`}
          loading="lazy"
        />
        <HStack>{renderCardActions(snap, project, build, docsId)}</HStack>
      </div>
    </div>
  );
}

function renderCardActions(
  snap: Snapshot,
  project: Project,
  build: Build,
  docsId: string | undefined,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <>
      <Button
        variant="secondary"
        href={`${urls.buildDiff(project.slug, build.id)}?snapshot=${snap.id}`}
      >
        Review
      </Button>
      <Button
        variant="ghost"
        href={`${urls.storybookBuild(project.slug, build.id)}/?storyId=${encodeURIComponent(snap.storyId)}`}
        target="_blank"
        rel="noopener"
      >
        Preview ↗
      </Button>
      {docsId ? (
        <Button
          variant="ghost"
          href={`/projects/${project.slug}/storybook/build/${build.id}/?storyId=${encodeURIComponent(docsId)}&viewMode=docs`}
          target="_blank"
          rel="noopener"
        >
          Docs ↗
        </Button>
      ) : null}
    </>
  );
}
