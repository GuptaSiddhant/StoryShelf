// oxlint-disable typescript/promise-function-async -- Hono JSX may return Promise<HtmlEscapedString>
import { BuildModel, ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import { loadHealthPanel, type HealthPanelData } from "../insights/health-panel.ts";
import { catalogOf, getStore, testingEnabled } from "../store.ts";
import {
  Button,
  EmptyState,
  FilterInput,
  HStack,
  Meta,
  PageHeader,
  SelectField,
  statusTone,
  Badge,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { ProjectDesignLinks } from "./design-links.tsx";
import { HealthSlot } from "./health-panel.tsx";
import { LibraryGrid } from "./library-grid.tsx";
import { entriesFromSnapshots, groupLibrary, type LibraryGroup } from "./library-model.ts";
import { loadSnapshotLayer, type SnapshotLayer } from "./library-snapshots.tsx";

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/**
 * Library page (ADR 0006, decision 9): the components of the latest build of the selected branch,
 * whatever its status, from the build's Storybook catalog. With `testing` the cards gain
 * screenshots, statuses and design links, and the page the health panel.
 */
export async function renderLibraryPage(
  slug: string,
  branch?: string,
): Promise<RenderedContent | null> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  if (!project) return null;
  const build = await getLibraryBuild(project, branch);
  if (!build) return renderEmptyLibrary(project);
  const data = await loadLibraryData(project, build);
  if (data.groups.length === 0) return renderNoStories(project, build);
  return (
    <DocumentLayout
      title="Library"
      nav={{ active: "library", projectSlug: project.slug, projectName: project.name }}
    >
      <LibraryHeader
        project={project}
        build={build}
        components={data.groups.length}
        stories={data.groups.reduce((total, group) => total + group.stories.length, 0)}
        branches={data.branches}
      />
      {data.layer && data.layer.design.projectLinks.length > 0 ? (
        <ProjectDesignLinks links={data.layer.design.projectLinks} />
      ) : null}
      <HealthSlot project={project} data={data.health} />
      <LibraryGrid groups={data.groups} project={project} build={build} layer={data.layer} />
      <div data-filter-empty hidden>
        <Meta center>No stories match your filter.</Meta>
      </div>
    </DocumentLayout>
  );
}

/** Everything the library renders of a build: catalog groups, branches, and the `testing` layer. */
interface LibraryData {
  groups: LibraryGroup[];
  branches: string[];
  layer: SnapshotLayer | null;
  health: HealthPanelData | null;
}

async function loadLibraryData(project: Project, build: Build): Promise<LibraryData> {
  const testing = testingEnabled();
  const [catalog, snapshots, branches] = await Promise.all([
    catalogOf().load(project.id, build.id),
    testing ? new SnapshotModel(getStore().db).listByBuild(build.id) : Promise.resolve([]),
    distinctBranches(project.id),
  ]);
  const entries = catalog?.entries ?? entriesFromSnapshots(snapshots);
  return {
    groups: groupLibrary(entries),
    branches,
    layer: snapshots.length > 0 ? await loadSnapshotLayer(project, snapshots) : null,
    health: testing ? await loadHealthPanel(project) : null,
  };
}

/** Latest build of the branch (default branch when none is chosen), whatever its status. */
async function getLibraryBuild(project: Project, branch?: string): Promise<Build | null> {
  const buildModel = new BuildModel(getStore().db);
  const trimmed = branch?.trim();
  const target = trimmed === undefined || trimmed === "" ? project.gitDefaultBranch : trimmed;
  const byBranch = await buildModel.list(project.id, { branch: target, limit: 1 });
  if (byBranch[0]) return byBranch[0];
  if (target !== project.gitDefaultBranch) {
    const defaults = await buildModel.list(project.id, {
      branch: project.gitDefaultBranch,
      limit: 1,
    });
    if (defaults[0]) return defaults[0];
  }
  return (await buildModel.list(project.id, { limit: 1 }))[0] ?? null;
}

async function distinctBranches(projectId: string): Promise<string[]> {
  const buildsList = await new BuildModel(getStore().db).list(projectId);
  return [...new Set(buildsList.map((b) => b.gitBranch))].toSorted((a, b) => a.localeCompare(b));
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

/** A build with nothing to list: still publishing, failed, or its Storybook is gone. */
function renderNoStories(project: Project, build: Build): RenderedContent {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const preparing = build.status === "pending";
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
        title={preparing ? "Preparing the library" : "No stories in the latest build"}
        description={
          preparing
            ? "The latest build is still being published. Reload in a moment."
            : "The latest build has no readable Storybook index, so there is nothing to list."
        }
        action={
          <Button variant="secondary" href={urls.build(project.slug, build.id)}>
            View build
          </Button>
        }
      />
    </DocumentLayout>
  );
}

function LibraryHeader(props: {
  project: Project;
  build: Build;
  components: number;
  stories: number;
  branches: string[];
}): Rendered {
  const { project, build } = props;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <PageHeader
      title="Library"
      description={
        <>
          {props.components} {props.components === 1 ? "component" : "components"} · {props.stories}{" "}
          {props.stories === 1 ? "story" : "stories"} · Latest build{" "}
          <a href={urls.build(project.slug, build.id)}>
            {build.gitBranch} · {build.gitSha.slice(0, 7)}
          </a>{" "}
          · {new Date(build.createdAt).toLocaleString()}{" "}
          <Badge tone={statusTone(build.status)}>{build.status}</Badge>
        </>
      }
      actions={
        <HStack>
          <FilterInput label="Filter stories" placeholder="Filter stories…" />
          <Button variant="ghost" size="sm" icon="external-link" href={urls.short(build.id)}>
            View Storybook
          </Button>
          <BranchPicker project={project} build={build} branches={props.branches} />
        </HStack>
      }
    />
  );
}

function BranchPicker(props: { project: Project; build: Build; branches: string[] }): Rendered {
  return (
    <form method="get" action={`/projects/${props.project.slug}/library`}>
      <HStack>
        <SelectField
          label="Branch"
          name="branch"
          layout="inline"
          value={props.build.gitBranch}
          options={props.branches.map((b) => ({ value: b, label: b }))}
        />
        <Button variant="secondary" type="submit">
          View
        </Button>
      </HStack>
    </form>
  );
}
