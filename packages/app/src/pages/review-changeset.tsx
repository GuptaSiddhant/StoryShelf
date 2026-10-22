/** The changeset card (ADR 0013, decision 8): components the build added, removed or changed. */
import type { ChangesetComponent } from "@storyshelf/core/models";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import { getStore } from "../store.ts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Meta,
  SectionTitle,
  Table,
  VStack,
} from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

type Kind = "added" | "changed" | "removed";

/** What the build changed in the Storybook catalog, against its baseline build. */
export function ChangesetCard(props: { data: ReviewSectionData }): Rendered {
  const { data } = props;
  const { baseline, changeset } = data.changeset;
  const total = changeset.added.length + changeset.changed.length + changeset.removed.length;
  return (
    <Card>
      <SectionTitle>Changes in this build</SectionTitle>
      <Meta>
        {baseline
          ? `Compared with the accepted build ${baseline.gitSha.slice(0, 7)} on ${baseline.gitBranch}.`
          : "No accepted build to compare with: every component counts as new."}{" "}
        A changed component has different stories, not necessarily a different look.
      </Meta>
      {total === 0 ? (
        <EmptyState
          title="No component changes"
          description={`${changeset.unchanged} components are the same as in the baseline.`}
        />
      ) : (
        <ChangesetTable data={data} />
      )}
    </Card>
  );
}

function ChangesetTable(props: { data: ReviewSectionData }): Rendered {
  const { data } = props;
  const { changeset } = data.changeset;
  return (
    <VStack>
      <HStack>
        <Badge tone="success">{changeset.added.length} added</Badge>
        <Badge tone="warning">{changeset.changed.length} changed</Badge>
        <Badge tone="danger">{changeset.removed.length} removed</Badge>
        <Meta as="span">{changeset.unchanged} unchanged</Meta>
      </HStack>
      <Table>
        <table>
          <caption class="visually-hidden">Components that changed in this build</caption>
          <thead>
            <tr>
              <th>Component</th>
              <th>Change</th>
              <th>Stories</th>
              <th>
                <span class="visually-hidden">Links</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows(data, "added", changeset.added)}
            {rows(data, "changed", changeset.changed)}
            {rows(data, "removed", changeset.removed)}
          </tbody>
        </table>
      </Table>
    </VStack>
  );
}

function rows(
  data: ReviewSectionData,
  kind: Kind,
  items: readonly (ChangesetComponent & { previousStoryCount?: number })[],
): Rendered[] {
  return items.map((item): Rendered => (
    <ChangeRow
      key={`${kind}:${item.importPath}:${item.title}`}
      data={data}
      kind={kind}
      item={item}
    />
  ));
}

const KIND_TONE = { added: "success", changed: "warning", removed: "danger" } as const;

function ChangeRow(props: {
  data: ReviewSectionData;
  kind: Kind;
  item: ChangesetComponent & { previousStoryCount?: number };
}): Rendered {
  const { data, kind, item } = props;
  const { project, build } = data;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const story = data.firstStory.get(item.importPath);
  return (
    <tr>
      <td>
        <strong>{item.title}</strong>
        <Meta as="div" mono>
          {item.importPath}
        </Meta>
      </td>
      <td>
        <Badge tone={KIND_TONE[kind]}>{kind}</Badge>
      </td>
      <td>
        {item.previousStoryCount !== undefined && item.previousStoryCount !== item.storyCount
          ? `${item.previousStoryCount} → ${item.storyCount}`
          : item.storyCount}
      </td>
      <td>
        <HStack>
          {kind !== "removed" && story ? (
            <Button
              variant="ghost"
              size="sm"
              href={`${urls.storybookBuild(project.slug, build.id)}/?path=/story/${encodeURIComponent(story)}`}
            >
              Story
            </Button>
          ) : null}
          {item.importPath ? (
            <Button variant="ghost" size="sm" href={urls.component(project.slug, item.importPath)}>
              Component
            </Button>
          ) : null}
        </HStack>
      </td>
    </tr>
  );
}
