import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { loadHealthPanel } from "../insights/health-panel.ts";
import { getStore } from "../store.ts";
import {
  Badge,
  Button,
  EmptyState,
  HStack,
  PageHeader,
  Segmented,
  SelectField,
  VStack,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { HealthSlot } from "./health-panel.tsx";
import { BuildsTable } from "./project-builds-table.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const STATUSES = ["reviewing", "approved", "rejected", "failed", "pending"] as const;

/** Current list filters (from the query string). */
interface BuildFilters {
  status?: string;
  branch?: string;
}

function listHref(base: string, filters: BuildFilters): string {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.branch) {
    params.set("branch", filters.branch);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

function matches(build: Build, filters: BuildFilters): boolean {
  return (
    (!filters.status || build.status === filters.status) &&
    (!filters.branch || build.gitBranch === filters.branch)
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
  const branches = [...new Set(all.map((build) => build.gitBranch))].toSorted();
  const inBranch = all.filter((build) => !filters.branch || build.gitBranch === filters.branch);
  const count = (status: string): number =>
    inBranch.filter((build) => build.status === status).length;
  const items = [
    { label: `All ${inBranch.length}`, value: "", status: undefined },
    ...STATUSES.filter((status) => count(status) > 0 || filters.status === status).map(
      (status) => ({ label: `${status} ${count(status)}`, value: status, status }),
    ),
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
      <form
        method="get"
        action={base}
        hx-get={base}
        hx-trigger="change"
        hx-target="body"
        hx-push-url="true"
      >
        {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
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
    </HStack>
  );
}

/** Project builds page: filterable build history for one project. */
export async function renderProjectBuildsPage(
  slug: string,
  query: BuildFilters = {},
): Promise<RenderedContent | null> {
  const projects = await new ProjectModel(getStore().db).list();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }
  const all = await new BuildModel(getStore().db).list(project.id);
  const builds = all.filter((build) => matches(build, query));
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const filtered = Boolean(query.status ?? query.branch);
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
        <BuildsToolbar
          project={project}
          all={all}
          filters={query}
          base={urls.buildsList(project.slug)}
        />
        {builds.length === 0 ? (
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
        ) : (
          <BuildsTable project={project} builds={builds} />
        )}
      </VStack>
    </DocumentLayout>
  );
}
