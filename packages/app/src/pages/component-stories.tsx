/** The catalog's tabs of the component page: its stories with a click-to-load preview, and its builds. */
import type { CatalogEntry } from "@storyshelf/core/capture";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import type { CatalogHistoryRow } from "../routers/component-catalog.handlers.ts";
import { isSignedPreviewBase, PREVIEW_TOKEN_REFRESH } from "../routers/preview-base.ts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Meta,
  PreviewEmbed,
  SectionTitle,
  Table,
  VStack,
} from "../ui/components.tsx";
import type { ComponentPageData } from "./component-detail.tsx";
import { StoryComments } from "./review-comments.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Stories tab: the selected story in a sandboxed preview, and every story and docs entry. */
export function StoriesTab(props: { data: ComponentPageData }): Rendered {
  const { data } = props;
  const { entries } = data.catalog;
  const selected = selectedStory(data);
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No stories in this build"
        description="The build's Storybook index lists no stories for this file."
      />
    );
  }
  return (
    <VStack>
      {selected ? <PreviewCard data={data} story={selected} /> : null}
      {selected && data.review ? (
        <StoryComments
          project={data.project}
          build={data.catalog.build}
          storyId={selected.id}
          comments={data.review.comments}
          canComment={data.review.canComment}
        />
      ) : null}
      <Card padded={false}>
        <Table>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Tags</th>
                <th>
                  <span class="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry): Rendered => (
                <EntryRow key={entry.id} entry={entry} data={data} selected={selected?.id} />
              ))}
            </tbody>
          </table>
        </Table>
      </Card>
    </VStack>
  );
}

/** The story the preview shows: `?story=` when it names one, else the first. */
function selectedStory(data: ComponentPageData): CatalogEntry | undefined {
  const stories = data.catalog.entries.filter((entry) => entry.type === "story");
  return stories.find((entry) => entry.id === data.story) ?? stories[0];
}

const previewPath = (story: CatalogEntry): string =>
  `/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;

/** A frame under a signed URL asks for a new token before the old one expires. */
function refreshOf(
  data: ComponentPageData,
  story: CatalogEntry,
): { refresh?: { url: string; path: string; seconds: number } } {
  if (data.previewBase === null || !isSignedPreviewBase(data.previewBase)) {
    return {};
  }
  return {
    refresh: {
      url: `/api/v1/projects/${data.project.slug}/builds/${data.catalog.build.id}/preview-token`,
      path: previewPath(story),
      seconds: PREVIEW_TOKEN_REFRESH,
    },
  };
}

function PreviewCard(props: { data: ComponentPageData; story: CatalogEntry }): Rendered {
  const { data, story } = props;
  return (
    <Card id="preview">
      <SectionTitle>{story.name}</SectionTitle>
      {data.previewBase === null ? (
        <Meta>
          This build needs a sign-in to view, so it cannot run in a frame here. Open it in Storybook
          instead.
        </Meta>
      ) : (
        <PreviewEmbed
          src={`${data.previewBase}${previewPath(story)}`}
          title={`${story.title} / ${story.name}`}
          {...refreshOf(data, story)}
        />
      )}
    </Card>
  );
}

function EntryRow(props: {
  entry: CatalogEntry;
  data: ComponentPageData;
  selected: string | undefined;
}): Rendered {
  const { entry, data } = props;
  return (
    <tr id={entry.id}>
      <td>{entry.name}</td>
      <td>
        <Badge tone={entry.type === "docs" ? "info" : "neutral"}>{entry.type}</Badge>
      </td>
      <td>{entry.tags.join(", ")}</td>
      <td>
        <HStack>
          {entry.type === "story" && entry.id !== props.selected ? (
            <Button
              variant="ghost"
              size="sm"
              icon="image"
              href={`?tab=stories&story=${encodeURIComponent(entry.id)}#preview`}
            >
              Preview
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            icon="external-link"
            href={`${storybookBase(data)}/?storyId=${encodeURIComponent(entry.id)}${entry.type === "docs" ? "&viewMode=docs" : ""}`}
            target="_blank"
            rel="noopener"
          >
            Open
          </Button>
        </HStack>
      </td>
    </tr>
  );
}

/** Published builds that hold the component, and whether its stories changed since the build before. */
export function ComponentBuilds(props: { data: ComponentPageData }): Rendered {
  const { data } = props;
  const urls = createUrlBuilder("/", data.publishedBaseDomain);
  const { history } = data.catalog;
  if (history.length === 0) {
    return (
      <EmptyState
        title="No published builds"
        description="No catalogued build holds this file yet."
      />
    );
  }
  return (
    <Card>
      <SectionTitle>Published builds</SectionTitle>
      <Table>
        <table>
          <thead>
            <tr>
              <th>Build</th>
              <th>Branch</th>
              <th>Stories</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row): Rendered => (
              <tr key={row.build.id}>
                <td>
                  <a href={urls.build(data.project.slug, row.build.id)}>
                    {row.build.gitSha.slice(0, 7)}
                  </a>
                </td>
                <td>{row.build.gitBranch}</td>
                <td>{row.component.storyCount}</td>
                <td>
                  <ChangeCell row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Table>
    </Card>
  );
}

function ChangeCell(props: { row: CatalogHistoryRow }): Rendered {
  const { row } = props;
  if (row.change === "new") {
    return <Badge tone="info">new here</Badge>;
  }
  if (row.change === "unchanged") {
    return <Meta as="span">unchanged</Meta>;
  }
  const parts = changeParts(row);
  return (
    <HStack>
      <Badge tone="warning">changed</Badge>
      {parts ? <Meta as="span">{parts}</Meta> : null}
    </HStack>
  );
}

/** "2 added · 1 removed · 1 renamed", or empty when the counts are not known. */
function changeParts(row: CatalogHistoryRow): string {
  const { changes } = row;
  if (!changes) {
    return "";
  }
  return [
    changes.added > 0 ? `${changes.added} added` : "",
    changes.removed > 0 ? `${changes.removed} removed` : "",
    changes.renamed > 0 ? `${changes.renamed} renamed` : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

function storybookBase(data: ComponentPageData): string {
  return createUrlBuilder("/", data.publishedBaseDomain).storybookBuild(
    data.project.slug,
    data.catalog.build.id,
  );
}
