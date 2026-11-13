import { contentHostSuffix } from "@storyshelf/core/config";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { loadHealthPanel } from "../insights/health-panel.ts";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import { getStore, testingEnabled } from "../store.ts";
import {
  Badge,
  Button,
  CheckField,
  EmptyState,
  HStack,
  PageHeader,
  Segmented,
  SelectField,
  VStack,
} from "../ui/components.tsx";
import { HealthSlot } from "./health-panel.tsx";
import { InheritedRatioCard } from "./inherited-ratio-card.tsx";
import { BuildsTable } from "./project-builds-table.tsx";
import { loadSkipSources } from "./skipped-source.ts";

const STATUSES = [
  "reviewing",
  "approved",
  "rejected",
  "failed",
  "cancelled",
  "pending",
  "skipped",
] as const;

/** Current list filters (from the query string). */
interface BuildFilters {
  status?: string;
  branch?: string;
  /** `"1"` shows skipped builds (hidden by default, ADR 0044). */
  skipped?: string;
}

const showsSkipped = (filters: BuildFilters): boolean => filters.skipped === "1";

function listHref(base: string, filters: BuildFilters): string {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.branch) {
    params.set("branch", filters.branch);
  }
  if (showsSkipped(filters)) {
    params.set("skipped", "1");
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

function matches(build: Build, filters: BuildFilters): boolean {
  return (
    (showsSkipped(filters) || build.status !== "skipped") &&
    (!filters.status || build.status === filters.status) &&
    (!filters.branch || build.gitBranch === filters.branch)
  );
}

/** Branch select that submits on change and keeps the status filter. */
function BranchFilter(props: {
  base: string;
  filters: BuildFilters;
  branches: string[];
  skippedTotal: number;
}): ReturnType<typeof SelectField> {
  const { base, filters, branches, skippedTotal } = props;
  return (
    <form
      method="get"
      action={base}
      hx-get={base}
      hx-trigger="change"
      hx-target="body"
      hx-push-url="true"
    >
      {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
      {skippedTotal > 0 ? (
        <CheckField
          label={`Show skipped (${skippedTotal})`}
          name="skipped"
          value="1"
          checked={showsSkipped(filters)}
        />
      ) : null}
      <SelectField
        label="Branch"
        name="branch"
        layout="inline"
        value={filters.branch ?? ""}
        options={[
          { value: "", label: "All branches" },
          ...branches.map((branch) => ({ value: branch, label: branch })),
        ]}
      />
    </form>
  );
}

/** Status chips (with counts) plus a branch select that applies instantly. */
function BuildsToolbar(props: {
  project: Project;
  all: Build[];
  filters: BuildFilters;
  base: string;
}): ReturnType<typeof HStack> {
  const { all, filters, base } = props;
  const skippedTotal = all.filter((build) => build.status === "skipped").length;
  const visible = all.filter((build) => showsSkipped(filters) || build.status !== "skipped");
  // Keep the selected branch in the list even when only skipped builds were on it.
  const branches = [
    ...new Set([
      ...visible.map((build) => build.gitBranch),
      ...(filters.branch ? [filters.branch] : []),
    ]),
  ].toSorted();
  const inBranch = visible.filter((build) => !filters.branch || build.gitBranch === filters.branch);
  const count = (status: string): number =>
    inBranch.filter((build) => build.status === status).length;
  const items = [
    { label: `All ${inBranch.length}`, value: "", status: undefined },
    ...STATUSES.filter(
      (status) =>
        (status !== "skipped" || showsSkipped(filters)) &&
        (count(status) > 0 || filters.status === status),
    ).map((status) => ({ label: `${status} ${count(status)}`, value: status, status })),
  ];
  return (
    <HStack justify="between">
      <Segmented
        label="Filter by status"
        items={items.map((item) => ({
          label: item.label,
          value: item.value,
          href: listHref(base, { ...filters, status: item.status }),
          active: (filters.status ?? "") === item.value,
        }))}
      />
      <BranchFilter base={base} filters={filters} branches={branches} skippedTotal={skippedTotal} />
    </HStack>
  );
}

/** The build table, or an empty state that explains whether a filter hides builds. */
function BuildsList(props: {
  project: Project;
  data: BuildsListData;
  query: BuildFilters;
}): ReturnType<typeof EmptyState> | ReturnType<typeof BuildsTable> {
  const { project, data, query } = props;
  const { builds, filtered, sources, everySkipped, skippedTotal } = data;
  const urls = createUrlBuilder("/", contentHostSuffix(getStore().config));
  if (builds.length > 0) {
    return <BuildsTable project={project} builds={builds} sources={sources} />;
  }
  if (everySkipped) {
    return (
      <EmptyState
        title="Every build here was skipped"
        description={`No story changed in any of the ${skippedTotal} builds, so none was captured. Show skipped to see them.`}
        action={
          <Button
            variant="secondary"
            href={listHref(urls.buildsList(project.slug), { ...query, skipped: "1" })}
          >
            Show skipped
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      title="No builds"
      description={
        filtered
          ? "No builds match the current filter."
          : "Upload your first build with the CLI. Builds appear here once uploaded."
      }
      action={
        filtered ? (
          <Button variant="secondary" href={urls.buildsList(project.slug)}>
            Clear filters
          </Button>
        ) : null
      }
    />
  );
}

/** Hiding skipped builds also drops a `status=skipped` filter, which would match nothing. */
function effectiveFilters(raw: BuildFilters): BuildFilters {
  return raw.status === "skipped" && !showsSkipped(raw) ? { ...raw, status: undefined } : raw;
}

/** What the builds page lists for one project and filter. */
interface BuildsListData {
  all: Build[];
  builds: Build[];
  skippedTotal: number;
  sources: Awaited<ReturnType<typeof loadSkipSources>>;
  filtered: boolean;
  /** Every build of the project was skipped and the filter hides them. */
  everySkipped: boolean;
}

async function loadBuildsListData(project: Project, query: BuildFilters): Promise<BuildsListData> {
  const all = await new BuildModel(getStore().db).list(project.id);
  const builds = all.filter((build) => matches(build, query));
  const skippedTotal = all.filter((build) => build.status === "skipped").length;
  const everySkipped =
    builds.length === 0 && skippedTotal > 0 && skippedTotal === all.length && !showsSkipped(query);
  const sources = await loadSkipSources(builds);
  return {
    all,
    builds,
    skippedTotal,
    sources,
    filtered: Boolean(query.status ?? query.branch),
    everySkipped,
  };
}

/** Project builds page: filterable build history for one project. */
export async function renderProjectBuildsPage(
  slug: string,
  rawQuery: BuildFilters = {},
): Promise<RenderedContent | null> {
  const query = effectiveFilters(rawQuery);
  const projects = await new ProjectModel(getStore().db).list();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }
  const data = await loadBuildsListData(project, query);
  const urls = createUrlBuilder("/", contentHostSuffix(getStore().config));
  const health = await loadHealthPanel(project);

  return (
    <DocumentLayout
      title={project.name}
      nav={{ active: "builds", projectSlug: project.slug, projectName: project.name }}
    >
      <PageHeader
        title="Builds"
        description={
          <>
            {project.gitRepository ?? project.slug} · default branch{" "}
            <Badge tone="neutral">{project.gitDefaultBranch}</Badge>
          </>
        }
        actions={
          <Button variant="secondary" icon="settings" href={urls.settings(project.slug)}>
            Settings
          </Button>
        }
      />
      <VStack>
        <HealthSlot project={project} data={health} />
        {testingEnabled() ? (
          <InheritedRatioCard builds={data.all.filter((build) => build.status !== "skipped")} />
        ) : null}
        <BuildsToolbar
          project={project}
          all={data.all}
          filters={query}
          base={urls.buildsList(project.slug)}
        />
        <BuildsList project={project} data={data} query={query} />
      </VStack>
    </DocumentLayout>
  );
}
