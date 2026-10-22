import {
  worstStatus,
  type ComponentHistoryRow,
  type ComponentPresence,
} from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ComponentCatalogView } from "../routers/component-catalog.handlers.ts";
import type { ComponentReview } from "../routers/review-section.handlers.ts";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Meta,
  PageHeader,
  SectionTitle,
  Table,
  Tabs,
  Thumbnail,
  VStack,
  statusTone,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import {
  snapshotCardBody,
  snapshotCardHead,
  snapshotCardMeta,
  snapshotGrid,
} from "../ui/styles/review.ts";
import type { SnapshotGroup } from "./build-diff-model.ts";
import { snapshotImageUrl, snapshotVariant } from "./build-diff-model.ts";
import { LinkedUsage, type LinkedUsageItem } from "./build-diff-usage.tsx";
import { ComponentBuilds, StoriesTab } from "./component-stories.tsx";
import { DesignReferences, DesignStrip, type DesignItem } from "./design-links.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Tabs of the component page. */
export type ComponentTab = "stories" | "states" | "history" | "design" | "linked";

const TAB_LABELS: Record<ComponentTab, string> = {
  stories: "Stories",
  states: "States",
  history: "History",
  design: "Design",
  linked: "Linked",
};

/** The tabs a page offers: the catalog's two in both modes, the snapshot ones only with `testing`. */
export function componentTabs(testing: boolean): readonly ComponentTab[] {
  return testing ? ["states", "stories", "history", "design", "linked"] : ["stories", "history"];
}

/** What captured snapshots add to a component (`testing` only; absent until it was captured). */
export interface CapturedComponent {
  /** Newest build that has the file; its states fill the States/Design/Linked tabs. */
  shownBuild: Build;
  groups: SnapshotGroup[];
  history: ComponentHistoryRow[];
  presence: ComponentPresence;
}

/** Data behind the component page. */
export interface ComponentPageData {
  project: Project;
  /** Normalized story-file path (the page's identity). */
  importPath: string;
  /** Title of the newest snapshot, else the catalog's (retitles update in place). */
  title: string;
  tab: ComponentTab;
  /** Whether the instance has `testing`. */
  testing: boolean;
  /** The published Storybook's view of the file: stories, docs entries, build history. */
  catalog: ComponentCatalogView;
  captured: CapturedComponent | null;
  /** Story id the Stories tab previews (the first story when unset or unknown). */
  story: string | undefined;
  /**
   * Root the preview frame loads the Storybook from: the build's own URL when it is open to anyone
   * who reaches the app, a signed `/_s/<token>` URL for a private build (needs `testing` and a
   * `secret`), or null when no frame can load.
   */
  previewBase: string | null;
  design: DesignItem[];
  usage: LinkedUsageItem[];
  /** Story comments of the shown build; null when the project has review off. */
  review: ComponentReview | null;
  publishedBaseDomain?: string;
}

/** Component detail page: stories, states, history, design and linked packages of one story file. */
export function renderComponentPage(data: ComponentPageData): RenderedContent {
  const { project, importPath, title } = data;
  return (
    <DocumentLayout
      title={`${title} · Component`}
      nav={{
        active: "library",
        projectSlug: project.slug,
        projectName: project.name,
        trail: [{ label: title }],
      }}
    >
      <PageHeader
        title={title}
        description={<span class="mono">{importPath}</span>}
        meta={<HeaderMeta data={data} />}
      />
      <PresenceNotice data={data} />
      <Tabs
        label="Component sections"
        tabs={componentTabs(data.testing).map((tab) => ({
          label: TAB_LABELS[tab],
          href: `?tab=${tab}`,
          active: data.tab === tab,
        }))}
      />
      <ActiveTab data={data} />
    </DocumentLayout>
  );
}

function HeaderMeta(props: { data: ComponentPageData }): Rendered {
  const { captured, catalog } = props.data;
  const stories = catalog.entries.filter((entry) => entry.type === "story").length;
  const docs = catalog.entries.length - stories;
  const counts = `${stories} ${stories === 1 ? "story" : "stories"}${docs > 0 ? ` · ${docs} docs` : ""}`;
  if (!captured) {
    return <>{counts}</>;
  }
  const status = worstStatus(captured.groups.map((group) => group.primary.status));
  const modes = new Set(captured.groups.map((group) => group.modeKey)).size;
  return (
    <>
      <Badge tone={statusTone(status)} icon>
        {status}
      </Badge>{" "}
      {counts} · {modes} {modes === 1 ? "mode" : "modes"}
    </>
  );
}

function PresenceNotice(props: { data: ComponentPageData }): Rendered | null {
  const { data } = props;
  const urls = createUrlBuilder("/", data.publishedBaseDomain);
  const presence = data.captured?.presence ?? data.catalog.presence;
  const { project } = data;
  if (presence.kind === "moved") {
    return (
      <Alert tone="warning" title="This component moved">
        <HStack>
          <span>The file now lives at</span>
          <Button variant="secondary" size="sm" href={urls.component(project.slug, presence.to)}>
            {presence.to}
          </Button>
        </HStack>
      </Alert>
    );
  }
  if (presence.kind === "deleted") {
    return (
      <Alert tone="warning" title="Not in the latest build">
        Last seen in{" "}
        <a href={urls.build(project.slug, presence.lastSeen.id)}>
          build {presence.lastSeen.gitSha.slice(0, 7)} ({presence.lastSeen.gitBranch})
        </a>
        . The states below are from that build.
      </Alert>
    );
  }
  return null;
}

function ActiveTab(props: { data: ComponentPageData }): Rendered {
  const { data } = props;
  if (data.tab === "stories") return <StoriesTab data={data} />;
  if (data.tab === "history") return <HistoryTab data={data} />;
  if (data.tab === "design") return <DesignTab design={data.design} />;
  if (data.tab === "linked") return <LinkedTab data={data} />;
  return <StatesTab data={data} />;
}

function StatesTab(props: { data: ComponentPageData }): Rendered {
  const { data } = props;
  const { project, captured } = data;
  if (!captured) {
    return (
      <EmptyState
        title="Not captured yet"
        description="No capture has rendered this file's stories. Its stories are listed under Stories."
      />
    );
  }
  const { shownBuild } = captured;
  const urls = createUrlBuilder("/", data.publishedBaseDomain);
  return (
    <div class={snapshotGrid}>
      {captured.groups.map((group): Rendered => (
        <div key={group.key} id={group.storyId}>
          <Card padded={false}>
            <div class={snapshotCardHead}>
              <strong>{group.primary.storyName}</strong>
              <span class={snapshotCardMeta}>
                <Badge tone={statusTone(group.primary.status)}>{group.primary.status}</Badge>{" "}
                {snapshotVariant(group.primary)}
              </span>
            </div>
            <div class={snapshotCardBody}>
              <a
                href={`${urls.buildDiff(project.slug, shownBuild.id)}?snapshot=${group.representative.id}`}
              >
                <Thumbnail
                  src={snapshotImageUrl(project, shownBuild, group.primary, "image")}
                  alt={`${group.primary.storyTitle} / ${group.primary.storyName}`}
                />
              </a>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

function HistoryTab(props: { data: ComponentPageData }): Rendered {
  const { data } = props;
  return (
    <VStack>
      {data.captured ? <CapturedHistory data={data} captured={data.captured} /> : null}
      <ComponentBuilds data={data} />
    </VStack>
  );
}

function CapturedHistory(props: {
  data: ComponentPageData;
  captured: CapturedComponent;
}): Rendered {
  const { data, captured } = props;
  return (
    <Card>
      <SectionTitle>Captured builds</SectionTitle>
      <Table>
        <table>
          <thead>
            <tr>
              <th>Build</th>
              <th>Branch</th>
              <th>States changed</th>
              <th>Status</th>
              <th>
                <span class="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {captured.history.map((row): Rendered => (
              <CapturedRow key={row.build.id} row={row} data={data} />
            ))}
          </tbody>
        </table>
      </Table>
    </Card>
  );
}

function CapturedRow(props: { row: ComponentHistoryRow; data: ComponentPageData }): Rendered {
  const { row, data } = props;
  const urls = createUrlBuilder("/", data.publishedBaseDomain);
  const slug = data.project.slug;
  return (
    <tr>
      <td>
        <a href={urls.build(slug, row.build.id)}>{row.build.gitSha.slice(0, 7)}</a>
      </td>
      <td>{row.build.gitBranch}</td>
      <td>
        {row.changedStates} / {row.states}
      </td>
      <td>
        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
      </td>
      <td>
        <Button
          variant="ghost"
          size="sm"
          href={`${urls.buildDiff(slug, row.build.id)}?snapshot=${row.snapshotId}`}
        >
          Review
        </Button>
      </td>
    </tr>
  );
}

function DesignTab(props: { design: DesignItem[] }): Rendered {
  if (props.design.length === 0) {
    return (
      <EmptyState
        title="No design linked"
        description="Declare a design link in the stories’ parameters, or map this file under Settings → Design."
      />
    );
  }
  return (
    <Card>
      <DesignStrip items={props.design} />
      <DesignReferences items={props.design} />
    </Card>
  );
}

function LinkedTab(props: { data: ComponentPageData }): Rendered {
  const { data } = props;
  if (data.usage.length === 0) {
    return (
      <EmptyState
        title="No linked packages"
        description="This component's stories use no packages linked to another project in the latest build."
      />
    );
  }
  return (
    <Card>
      <Meta>Packages these stories use, linked to the projects that publish them.</Meta>
      <LinkedUsage usage={data.usage} publishedBaseDomain={data.publishedBaseDomain} />
    </Card>
  );
}
