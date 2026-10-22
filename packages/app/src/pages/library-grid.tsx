/** The library's component list: one card per title, from the catalog, with snapshots layered on. */
import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import { getStore } from "../store.ts";
import {
  Badge,
  Button,
  Card,
  CardSection,
  HStack,
  Meta,
  SectionTitle,
  VStack,
} from "../ui/components.tsx";
import type { LibraryGroup } from "./library-model.ts";
import { SnapshotCards, type SnapshotLayer } from "./library-snapshots.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** The component cards of a build; `layer` is present only with `testing` and captured snapshots. */
export function LibraryGrid(props: {
  groups: LibraryGroup[];
  project: Project;
  build: Build;
  layer: SnapshotLayer | null;
}): Rendered {
  return (
    <VStack>
      {props.groups.map((group): Rendered => (
        <LibraryCard
          key={group.title}
          group={group}
          project={props.project}
          build={props.build}
          layer={props.layer}
        />
      ))}
    </VStack>
  );
}

function LibraryCard(props: {
  group: LibraryGroup;
  project: Project;
  build: Build;
  layer: SnapshotLayer | null;
}): Rendered {
  const { group, project, build, layer } = props;
  const href = componentHref(project, group);
  const captured = layer ? group.stories.flatMap((story) => layer.byStory.get(story.id) ?? []) : [];
  const plain = group.stories.filter((story) => !layer?.byStory.has(story.id));
  return (
    <Card
      padded={false}
      data-filter-item
      data-filter-text={`${group.title} ${group.stories.map((story) => story.name).join(" ")}`}
    >
      <CardSection divider>
        <SectionTitle>{href ? <a href={href}>{group.title}</a> : group.title}</SectionTitle>
        <HStack>
          {group.tags.map((tag) => (
            <Badge key={tag} tone="neutral">
              {tag}
            </Badge>
          ))}
          <Meta as="span">
            {group.stories.length} {group.stories.length === 1 ? "story" : "stories"}
          </Meta>
          <DocsLink group={group} project={project} build={build} />
        </HStack>
      </CardSection>
      <CardSection>
        <VStack>
          {layer && captured.length > 0 ? (
            <SnapshotCards
              snapshots={captured}
              project={project}
              buildId={build.id}
              layer={layer}
              componentHref={href}
            />
          ) : null}
          {plain.length > 0 ? <StoryLinks stories={plain} project={project} build={build} /> : null}
        </VStack>
      </CardSection>
    </Card>
  );
}

/** Component page of a group (its story file), when the index names one. */
function componentHref(project: Project, group: LibraryGroup): string | undefined {
  return group.importPath
    ? createUrlBuilder("/", getStore().config.publishedBaseDomain).component(
        project.slug,
        group.importPath,
      )
    : undefined;
}

function DocsLink(props: { group: LibraryGroup; project: Project; build: Build }): Rendered | null {
  const docs = props.group.docs[0];
  if (!docs) {
    return null;
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      icon="book"
      href={`/projects/${props.project.slug}/storybook/build/${props.build.id}/?storyId=${encodeURIComponent(docs.id)}&viewMode=docs`}
      target="_blank"
      rel="noopener"
    >
      Docs
    </Button>
  );
}

/** Links into the published Storybook, one per story, for stories without a snapshot. */
function StoryLinks(props: {
  stories: LibraryGroup["stories"];
  project: Project;
  build: Build;
}): Rendered {
  const base = createUrlBuilder("/", getStore().config.publishedBaseDomain).storybookBuild(
    props.project.slug,
    props.build.id,
  );
  return (
    <HStack>
      {props.stories.map((story): Rendered => (
        <span key={story.id} data-filter-item data-filter-text={`${story.title} ${story.name}`}>
          <Button
            variant="ghost"
            size="sm"
            icon="external-link"
            href={`${base}/?storyId=${encodeURIComponent(story.id)}`}
            target="_blank"
            rel="noopener"
          >
            {story.name}
          </Button>
        </span>
      ))}
    </HStack>
  );
}
