// oxlint-disable typescript/promise-function-async -- Hono JSX may return Promise<HtmlEscapedString>
import type { DesignDrift } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import { getStore } from "../store.ts";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  HStack,
  Meta,
  PageHeader,
  SectionTitle,
  Stat,
  Table,
  VStack,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** One design link of a component, with what was stored about it. */
export interface CoverageLink {
  url: string;
  providerName: string;
  /** Design node name from the cache, when one is stored. */
  name: string | null;
  drift: DesignDrift;
}

/** A component (story file) and the design links it resolves to. */
export interface CoverageComponent {
  title: string;
  importPath: string;
  links: CoverageLink[];
}

/** Everything the coverage page shows; built from stored data only (no provider calls). */
export interface DesignCoverageData {
  project: Project;
  /** The accepted build whose catalog was read; null when the project has none. */
  build: Build | null;
  /** Components with no design link. */
  unlinked: CoverageComponent[];
  /** Linked components whose design changed after the baseline was approved, or was deleted. */
  drifted: CoverageComponent[];
  /** Linked and up to date. */
  current: number;
  /** Linked, but nothing stored says whether the design changed (no token, or not fetched yet). */
  unknown: number;
  /** Providers whose links cannot be checked because the project has no token for them. */
  withoutToken: string[];
  /** Whether links declared in stories were read (they need captured snapshots, so `testing`). */
  storyLinksRead: boolean;
}

/** The design coverage page: what lacks a design, what drifted, and how much is in sync. */
export function renderDesignCoveragePage(data: DesignCoverageData): RenderedContent {
  const { project, build } = data;
  return (
    <DocumentLayout
      title="Design coverage"
      nav={{
        active: "library",
        projectSlug: project.slug,
        projectName: project.name,
        trail: [{ label: "Design coverage" }],
      }}
    >
      <PageHeader
        title="Design coverage"
        description={
          build ? (
            <>
              Components of the latest accepted build ({build.gitBranch} ·{" "}
              {build.gitSha.slice(0, 7)}) against their design links.
            </>
          ) : (
            <>Components against their design links.</>
          )
        }
      />
      {build ? (
        <CoverageBody data={data} />
      ) : (
        <EmptyState
          title="No accepted build yet"
          description="Coverage is read from the latest accepted build's Storybook. Upload and approve a build first."
        />
      )}
    </DocumentLayout>
  );
}

function CoverageBody(props: { data: DesignCoverageData }): Rendered {
  const { data } = props;
  const linked = data.drifted.length + data.current + data.unknown;
  return (
    <VStack>
      {data.storyLinksRead ? null : (
        <Alert tone="info" title="Only mapped design links are counted">
          Links declared in stories are read from captured builds, so they are not counted without
          testing. Components linked under Settings → Design are.
        </Alert>
      )}
      <div class="grid grid--3">
        <Stat label="Components" value={linked + data.unlinked.length} />
        <Stat label="With a design link" value={linked} tone={linked > 0 ? "success" : "neutral"} />
        <Stat
          label="Needing attention"
          value={data.unlinked.length + data.drifted.length}
          tone={data.unlinked.length + data.drifted.length > 0 ? "warning" : "success"}
        />
      </div>
      <UnlinkedSection data={data} />
      <DriftSection data={data} />
      <CurrentSection data={data} />
    </VStack>
  );
}

function ComponentLink(props: { project: Project; component: CoverageComponent }): Rendered {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const { project, component } = props;
  return <a href={urls.component(project.slug, component.importPath)}>{component.title}</a>;
}

function UnlinkedSection(props: { data: DesignCoverageData }): Rendered {
  const { project, unlinked } = props.data;
  return (
    <VStack>
      <SectionTitle>No design link ({unlinked.length})</SectionTitle>
      {unlinked.length === 0 ? (
        <Meta>Every component has a design link.</Meta>
      ) : (
        <Table>
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Story file</th>
              </tr>
            </thead>
            <tbody>
              {unlinked.map((component) => (
                <tr key={component.importPath}>
                  <td>
                    <ComponentLink project={project} component={component} />
                  </td>
                  <td class="mono">{component.importPath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Table>
      )}
    </VStack>
  );
}

function DriftBadge(props: { drift: DesignDrift }): Rendered {
  return props.drift === "deleted" ? (
    <Badge tone="danger">Design deleted</Badge>
  ) : (
    <Badge tone="warning">Design changed</Badge>
  );
}

/** One row per drifted design link of a component. */
function DriftRows(props: { project: Project; component: CoverageComponent }): Rendered {
  const { project, component } = props;
  return (
    <>
      {component.links
        .filter((link) => link.drift === "stale" || link.drift === "deleted")
        .map((link) => (
          <tr key={`${component.importPath}|${link.url}`}>
            <td>
              <VStack>
                <ComponentLink project={project} component={component} />
                <span>
                  <DriftBadge drift={link.drift} />
                </span>
              </VStack>
            </td>
            <td>
              <HStack wrap={false}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="external-link"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in {link.providerName}
                </Button>
                {link.name ? <Meta as="span">{link.name}</Meta> : null}
              </HStack>
            </td>
          </tr>
        ))}
    </>
  );
}

function DriftSection(props: { data: DesignCoverageData }): Rendered {
  const { project, drifted, withoutToken } = props.data;
  return (
    <VStack>
      <SectionTitle>Design changed or deleted ({drifted.length})</SectionTitle>
      {withoutToken.length > 0 ? (
        <Alert tone="info" title="Design status is unavailable for some links">
          {withoutToken.join(", ")} has no token for this project, so StoryShelf cannot tell whether
          those designs changed or were deleted. Add one under Settings → Design.
        </Alert>
      ) : null}
      {drifted.length === 0 ? (
        <Meta>No linked design is known to have changed or been deleted.</Meta>
      ) : (
        <Table>
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Design</th>
              </tr>
            </thead>
            <tbody>
              {drifted.map((component) => (
                <DriftRows key={component.importPath} project={project} component={component} />
              ))}
            </tbody>
          </table>
        </Table>
      )}
    </VStack>
  );
}

function CurrentSection(props: { data: DesignCoverageData }): Rendered {
  const { current, unknown } = props.data;
  return (
    <VStack>
      <SectionTitle>Up to date ({current})</SectionTitle>
      <Meta>
        {current} linked {current === 1 ? "component is" : "components are"} up to date with the
        approved baseline.
        {unknown > 0
          ? ` ${unknown} more ${unknown === 1 ? "has" : "have"} a link but nothing stored says whether the design changed.`
          : ""}
      </Meta>
    </VStack>
  );
}
