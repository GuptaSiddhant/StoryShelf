import {
  worstStatus,
  type ComponentHistoryRow,
  type ComponentPresence,
} from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
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
import { DesignReferences, DesignStrip, type DesignItem } from "./design-links.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Tabs of the component page. */
export type ComponentTab = "states" | "history" | "figma" | "linked";

export const COMPONENT_TABS: readonly ComponentTab[] = ["states", "history", "figma", "linked"];

const TAB_LABELS: Record<ComponentTab, string> = {
  states: "States",
  history: "History",
  figma: "Figma",
  linked: "Linked",
};

/** Data behind the component page. */
export interface ComponentPageData {
  project: Project;
  /** Normalized story-file path (the page's identity). */
  importPath: string;
  /** Title of the newest snapshot (retitles update in place). */
  title: string;
  tab: ComponentTab;
  /** Newest build that has the file; its states fill the States/Figma/Linked tabs. */
  shownBuild: Build;
  groups: SnapshotGroup[];
  history: ComponentHistoryRow[];
  presence: ComponentPresence;
  design: DesignItem[];
  usage: LinkedUsageItem[];
  publishedBaseDomain?: string;
}

/** Component detail page: states, history, Figma and linked packages of one story file. */
export function renderComponentPage(data: ComponentPageData): RenderedContent {
  const { project, importPath, title } = data;
  const status = worstStatus(data.groups.map((group) => group.primary.status));
  const viewports = new Set(data.groups.map((group) => group.modeKey)).size;
  const stories = new Set(data.groups.map((group) => group.storyId)).size;
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
        meta={
          <>
            <Badge tone={statusTone(status)} icon>
              {status}
            </Badge>{" "}
            {stories} {stories === 1 ? "state" : "states"} · {viewports}{" "}
            {viewports === 1 ? "mode" : "modes"}
          </>
        }
      />
      <PresenceNotice data={data} />
      <Tabs
        label="Component sections"
        tabs={COMPONENT_TABS.map((tab) => ({
          label: TAB_LABELS[tab],
          href: `?tab=${tab}`,
          active: data.tab === tab,
        }))}
      />
      <ActiveTab data={data} />
    </DocumentLayout>
  );
}

function PresenceNotice(props: { data: ComponentPageData }): Rendered | null {
  const { data } = props;
  const urls = createUrlBuilder("/", data.publishedBaseDomain);
  const { presence, project } = data;
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
  if (data.tab === "history") return <HistoryTab data={data} />;
  if (data.tab === "figma") return <FigmaTab design={data.design} />;
  if (data.tab === "linked") return <LinkedTab data={data} />;
  return <StatesTab data={data} />;
}

function StatesTab(props: { data: ComponentPageData }): Rendered {
  const { data } = props;
  const { project, shownBuild } = data;
  const urls = createUrlBuilder("/", data.publishedBaseDomain);
  return (
    <div class={snapshotGrid}>
      {data.groups.map((group): Rendered => (
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
  const urls = createUrlBuilder("/", data.publishedBaseDomain);
  const slug = data.project.slug;
  return (
    <Card>
      <SectionTitle>History</SectionTitle>
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
            {data.history.map((row): Rendered => (
              <tr key={row.build.id}>
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
            ))}
          </tbody>
        </table>
      </Table>
    </Card>
  );
}

function FigmaTab(props: { design: DesignItem[] }): Rendered {
  if (props.design.length === 0) {
    return (
      <EmptyState
        title="No Figma design linked"
        description="Add parameters.storyshelf.figma to the stories, or map this file under Settings → Design."
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
