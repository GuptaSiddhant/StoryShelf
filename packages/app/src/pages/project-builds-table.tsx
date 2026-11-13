import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import { getStore, testingEnabled } from "../store.ts";
import {
  Avatar,
  Badge,
  Button,
  HStack,
  Meta,
  RelativeTime,
  Table,
  statusTone,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { type SkipSource, noStoryChangedText, skipSourceSha } from "./skipped-source.ts";
const buildCell = css`
  /* build-cell */
  display: grid;
  gap: 2px;
  min-width: 0;
  max-width: 38ch;
  & strong a {
    color: var(--text-primary);
  }
  & strong a:hover {
    color: var(--accent-fg);
  }
`;

const messageLine = css`
  /* build-message */
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const authorCell = css`
  /* build-author */
  display: flex;
  gap: var(--space-2);
  align-items: center;
  white-space: nowrap;
`;

/** "4 to review · 1 approved · 12 snapshots", leaving out zero counts. */
function changeSummary(build: Build): string {
  const parts: string[] = [];
  if (build.changedCount > 0) {
    parts.push(`${build.changedCount} to review`);
  }
  if (build.approvedCount > 0) {
    parts.push(`${build.approvedCount} approved`);
  }
  parts.push(`${build.snapshotCount} ${build.snapshotCount === 1 ? "snapshot" : "snapshots"}`);
  return parts.join(" · ");
}

/** "No story changed since a1b2c3d", the sha linking to the build this one repeats. */
function SkippedSummary({
  project,
  build,
  source,
}: {
  project: Project;
  build: Build;
  source: SkipSource | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const sha = skipSourceSha(build, source);
  if (!source?.build || !sha) {
    return <>{noStoryChangedText(sha)}</>;
  }
  return (
    <>
      No story changed since <a href={urls.build(project.slug, source.build.id)}>{sha}</a>
    </>
  );
}

function BuildSummaryCell({
  project,
  build,
}: {
  project: Project;
  build: Build;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <div class={buildCell}>
      <strong>
        <a href={urls.build(project.slug, build.id)}>{build.gitBranch}</a>{" "}
        <Meta as="span" mono>
          {build.gitSha.slice(0, 7)}
        </Meta>
      </strong>
      <span class={messageLine}>{build.message ?? "No message"}</span>
    </div>
  );
}

function BuildActions({
  project,
  build,
  source,
}: {
  project: Project;
  build: Build;
  source: SkipSource | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  // The diff page is a testing route; hosting-only instances link to the build page.
  const needsReview = build.status === "reviewing" && testingEnabled();
  // A skipped build has no Storybook of its own: link the source's, while it is available.
  const skipped = build.status === "skipped";
  const storybookId = skipped ? source?.build?.id : build.id;
  const showStorybook = skipped ? source?.storybook === true && Boolean(storybookId) : true;
  const storybookLabel = skipped ? "View source Storybook" : "View Storybook";
  return (
    <HStack wrap={false} justify="end">
      <Button
        variant={needsReview ? "primary" : "secondary"}
        size="sm"
        href={
          needsReview ? urls.buildDiff(project.slug, build.id) : urls.build(project.slug, build.id)
        }
      >
        {needsReview ? "Review" : "View"}
      </Button>
      {showStorybook ? (
        <Button
          variant="ghost"
          size="sm"
          icon="external-link"
          href={urls.short(storybookId ?? build.id)}
          aria-label={storybookLabel}
          title={storybookLabel}
        />
      ) : null}
    </HStack>
  );
}

function BuildRow({
  project,
  build,
  source,
}: {
  project: Project;
  build: Build;
  source: SkipSource | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <tr>
      <td>
        <BuildSummaryCell project={project} build={build} />
      </td>
      <td>
        <Badge tone={statusTone(build.status)} icon>
          {build.status}
        </Badge>
      </td>
      <td>
        <Meta as="span">
          {build.status === "skipped" ? (
            <SkippedSummary project={project} build={build} source={source} />
          ) : (
            changeSummary(build)
          )}
        </Meta>
      </td>
      <td>
        <div class={authorCell}>
          {build.authorName ? <Avatar name={build.authorName} size="sm" /> : null}
          <span>{build.authorName ?? "—"}</span>
        </div>
      </td>
      <td class="nowrap">
        <Meta as="span">
          <RelativeTime value={build.createdAt} />
        </Meta>
      </td>
      <td class="nowrap">
        <BuildActions project={project} build={build} source={source} />
      </td>
    </tr>
  );
}

/** Builds as a table: branch/sha, status, change summary, author, age, actions. */
export function BuildsTable({
  project,
  builds,
  sources = new Map(),
}: {
  project: Project;
  builds: Build[];
  /** What each skipped build repeats, keyed by the skipped build's id. */
  sources?: Map<string, SkipSource>;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <Table label="Builds">
      <table>
        <thead>
          <tr>
            <th>Build</th>
            <th>Status</th>
            <th>Changes</th>
            <th>Author</th>
            <th>Created</th>
            <th>
              <span class="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {builds.map((build) => (
            <BuildRow
              key={build.id}
              project={project}
              build={build}
              source={sources.get(build.id)}
            />
          ))}
        </tbody>
      </table>
    </Table>
  );
}
