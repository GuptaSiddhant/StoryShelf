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
  Card,
  EmptyState,
  HStack,
  Meta,
  PageHeader,
  RelativeTime,
  SectionTitle,
  Stat,
  Table,
  VStack,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** One design link of a component, with what was stored about it. */
export interface CoverageLink {
  url: string;
  providerName: string;
  /** Design node name from the cache, when one is stored. */
  name: string | null;
  drift: DesignDrift;
  /** When the design last changed, as the provider reported it; null when unknown. */
  changedAt: string | null;
}

/** A component (story file) and the design links it resolves to. */
export interface CoverageComponent {
  title: string;
  importPath: string;
  /** How many stories the component has. */
  stories: number;
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
  /** When the linked designs' metadata was last fetched; null when it never was. */
  lastChecked: string | null;
  /** Whether links declared in stories were read (they need captured snapshots, so `testing`). */
  storyLinksRead: boolean;
}

/* Secondary columns drop out on phones; the date moves under the reason (see the spec on #458). */
const wideOnly = css`
  /* coverage-wide-only */
  @media (max-width: 640px) {
    & {
      display: none;
    }
  }
`;

const narrowOnly = css`
  /* coverage-narrow-only */
  display: none;
  @media (max-width: 640px) {
    & {
      display: block;
    }
  }
`;

const statLink = css`
  /* coverage-stat-link */
  display: block;
  color: inherit;
  text-decoration: none;
  &:hover,
  &:focus-visible {
    text-decoration: none;
  }
`;

const widePath = css`
  /* coverage-wide-path */
  ${wideOnly}
  overflow-wrap: anywhere;
`;

/** The design coverage page: what lacks a design, what drifted, and how much is in sync. */
export function renderDesignCoveragePage(data: DesignCoverageData): RenderedContent {
  const { project, build } = data;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <DocumentLayout
      title="Design coverage"
      nav={{
        active: "library",
        projectSlug: project.slug,
        projectName: project.name,
        trail: [
          { label: "Library", href: urls.library(project.slug) },
          { label: "Design coverage" },
        ],
      }}
    >
      <PageHeader
        title="Design coverage"
        description="Which components have a design file, and which have drifted from it."
        meta={
          build
            ? `Latest accepted build: ${build.gitBranch} · ${build.gitSha.slice(0, 7)}`
            : undefined
        }
      />
      {build ? (
        <CoverageBody data={data} />
      ) : (
        <EmptyState
          title="No build to check yet"
          description="Design coverage is read from the latest accepted build. Upload a Storybook and accept a build first."
          action={
            <Button variant="secondary" size="sm" href={urls.buildsList(project.slug)}>
              Go to builds
            </Button>
          }
        />
      )}
    </DocumentLayout>
  );
}

/** Drift cannot be told for the linked designs: some provider has no token and nothing is known to have drifted. */
function driftUnavailable(data: DesignCoverageData): boolean {
  return data.withoutToken.length > 0 && data.drifted.length === 0;
}

function CoverageBody(props: { data: DesignCoverageData }): Rendered {
  const { data } = props;
  const unavailable = driftUnavailable(data);
  return (
    <VStack>
      {data.storyLinksRead ? null : (
        <Alert tone="info" title="Only mapped design links are counted">
          Links declared in stories are read from captured builds, so they are not counted without
          testing. Components linked under Settings → Design are.
        </Alert>
      )}
      <div class="grid grid--3">
        <a href="#no-link" class={statLink}>
          <Stat
            label="No design link"
            value={data.unlinked.length}
            tone={data.unlinked.length > 0 ? "warning" : "success"}
          />
        </a>
        <a href="#drift" class={statLink}>
          <Stat
            label={unavailable ? "Needs attention · Unavailable" : "Needs attention"}
            value={unavailable ? "–" : data.drifted.length}
            tone={unavailable ? "neutral" : data.drifted.length > 0 ? "warning" : "success"}
          />
        </a>
        <a href="#current" class={statLink}>
          <Stat
            label="Up to date"
            value={data.current}
            tone={data.current > 0 ? "success" : "neutral"}
          />
        </a>
      </div>
      <UnlinkedSection data={data} />
      <DriftSection data={data} />
      <CurrentSection data={data} />
    </VStack>
  );
}

/** Where a component's design links are managed: its Design tab with testing, else the project's design settings. */
function linkTarget(data: DesignCoverageData, component: CoverageComponent): string {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return data.storyLinksRead
    ? urls.component(data.project.slug, component.importPath, { tab: "design" })
    : `${urls.settings(data.project.slug)}/design`;
}

function ComponentLink(props: {
  data: DesignCoverageData;
  component: CoverageComponent;
}): Rendered {
  const { data, component } = props;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const href = data.storyLinksRead
    ? urls.component(data.project.slug, component.importPath, { tab: "design" })
    : urls.component(data.project.slug, component.importPath);
  return <a href={href}>{component.title}</a>;
}

function UnlinkedRow(props: { data: DesignCoverageData; component: CoverageComponent }): Rendered {
  const { data, component } = props;
  return (
    <tr>
      <td>
        <ComponentLink data={data} component={component} />
        <div class={narrowOnly}>
          <Meta as="span" mono>
            {component.importPath}
          </Meta>
        </div>
      </td>
      <td class={widePath}>
        <span class="mono">{component.importPath}</span>
      </td>
      <td class={wideOnly}>{component.stories}</td>
      <td>
        <Button
          variant="ghost"
          size="sm"
          href={linkTarget(data, component)}
          aria-label={`Link a design to ${component.title}`}
        >
          Link a design
        </Button>
      </td>
    </tr>
  );
}

function UnlinkedSection(props: { data: DesignCoverageData }): Rendered {
  const { data } = props;
  const { unlinked } = data;
  return (
    <Card id="no-link">
      <VStack>
        <SectionTitle>No design link ({unlinked.length})</SectionTitle>
        {unlinked.length === 0 ? (
          <EmptyState title="Every component has a design link" />
        ) : (
          <Table>
            <table>
              <thead>
                <tr>
                  <th>Component</th>
                  <th class={wideOnly}>Path</th>
                  <th class={wideOnly}>Stories</th>
                  <th>
                    <span class="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {unlinked.map((component) => (
                  <UnlinkedRow key={component.importPath} data={data} component={component} />
                ))}
              </tbody>
            </table>
          </Table>
        )}
      </VStack>
    </Card>
  );
}

const REASONS: Record<"stale" | "deleted", { badge: string; title: string }> = {
  stale: { badge: "Design changed", title: "Design changed after approval" },
  deleted: { badge: "Deleted", title: "Design file deleted" },
};

function DriftBadge(props: { drift: DesignDrift }): Rendered {
  const reason = props.drift === "deleted" ? REASONS.deleted : REASONS.stale;
  return (
    <span title={reason.title}>
      <Badge tone={props.drift === "deleted" ? "danger" : "warning"} icon>
        {reason.badge}
      </Badge>
    </span>
  );
}

function ChangedAt(props: { value: string | null }): Rendered {
  return props.value ? <RelativeTime value={props.value} /> : <Meta as="span">unknown</Meta>;
}

/** One row per drifted design link of a component. */
function DriftRows(props: { data: DesignCoverageData; component: CoverageComponent }): Rendered {
  const { data, component } = props;
  return (
    <>
      {component.links
        .filter((link) => link.drift === "stale" || link.drift === "deleted")
        .map((link) => (
          <tr key={`${component.importPath}|${link.url}`}>
            <td>
              <VStack>
                <ComponentLink data={data} component={component} />
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
                </HStack>
                {link.name ? <Meta as="span">{link.name}</Meta> : null}
              </VStack>
            </td>
            <td>
              <DriftBadge drift={link.drift} />
              <div class={narrowOnly}>
                <Meta as="span">
                  <ChangedAt value={link.changedAt} />
                </Meta>
              </div>
            </td>
            <td class={wideOnly}>
              <ChangedAt value={link.changedAt} />
            </td>
          </tr>
        ))}
    </>
  );
}

/** Says which providers cannot be checked and where to add a token. */
function DriftAlert(props: { data: DesignCoverageData }): Rendered {
  const { project, withoutToken } = props.data;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <Alert tone="info" title="Drift can't be checked">
      {withoutToken.join(", ")} has no access token for this project, so StoryShelf cannot see which
      designs changed. Add one in Settings → Design.
      <div class="mt-1">
        <Button variant="secondary" size="sm" href={`${urls.settings(project.slug)}/design`}>
          Open design settings
        </Button>
      </div>
    </Alert>
  );
}

function DriftTable(props: { data: DesignCoverageData }): Rendered {
  const { data } = props;
  return (
    <Table>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Reason</th>
            <th class={wideOnly}>Design changed</th>
          </tr>
        </thead>
        <tbody>
          {data.drifted.map((component) => (
            <DriftRows key={component.importPath} data={data} component={component} />
          ))}
        </tbody>
      </table>
    </Table>
  );
}

function DriftSection(props: { data: DesignCoverageData }): Rendered {
  const { data } = props;
  const { drifted, withoutToken, lastChecked } = data;
  const unavailable = driftUnavailable(data);
  return (
    <Card id="drift">
      <VStack>
        <SectionTitle>
          {unavailable ? "Needs attention" : `Needs attention (${drifted.length})`}
        </SectionTitle>
        {unavailable ? null : (
          <Meta>
            {lastChecked ? (
              <>
                Last checked <RelativeTime value={lastChecked} />
              </>
            ) : (
              "Not checked yet"
            )}
          </Meta>
        )}
        {withoutToken.length > 0 ? <DriftAlert data={data} /> : null}
        {drifted.length > 0 ? <DriftTable data={data} /> : null}
        {drifted.length === 0 && !unavailable ? <EmptyState title="No drift found" /> : null}
      </VStack>
    </Card>
  );
}

function CurrentSection(props: { data: DesignCoverageData }): Rendered {
  const { current, unknown } = props.data;
  const unknownText = `${unknown} more ${unknown === 1 ? "has" : "have"} a link but nothing stored says whether the design changed.`;
  return (
    <Card id="current">
      <VStack>
        <SectionTitle>Up to date</SectionTitle>
        <Meta>
          {current > 0
            ? `${current} ${current === 1 ? "component is" : "components are"} linked and ${current === 1 ? "matches" : "match"} their approved design.`
            : unknown === 0
              ? "No linked components yet."
              : ""}
          {unknown > 0 ? ` ${unknownText}` : ""}
        </Meta>
      </VStack>
    </Card>
  );
}
