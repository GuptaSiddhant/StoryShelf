import type { Build, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import { getStore } from "../store.ts";
import {
  Alert,
  Badge,
  Button,
  Card,
  Meta,
  PageHeader,
  SectionTitle,
  VStack,
  statusTone,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import {
  type SkipSource,
  loadSkipSource,
  noStoryChangedText,
  skipSourceSha,
} from "./skipped-source.ts";

/** Changed files shown before the rest fold into a `<details>`. */
const VISIBLE_FILES = 10;

const termList = css`
  /* skipped-terms */
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  & dd {
    margin: 0;
    min-width: 0;
  }
`;

const fileList = css`
  /* skipped-files */
  margin: 0;
  padding-left: var(--space-4);
  & code {
    overflow-wrap: anywhere;
  }
`;

/** The recorded changed files (a JSON array, null when none was stored). */
function changedFilesOf(build: Build): string[] {
  try {
    const parsed: unknown = JSON.parse(build.changedFiles ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function SourceAlert({
  project,
  source,
}: {
  project: Project;
  source: SkipSource;
}): ReturnType<typeof Alert> | null {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  if (!source.build) {
    return <Alert tone="warning">The build this one repeats is no longer available.</Alert>;
  }
  if (source.build.status === "approved" || source.build.status === "skipped") {
    return null;
  }
  return (
    <Alert tone="danger">
      The build this one repeats is now <strong>{source.build.status}</strong>, and this
      commit&apos;s check reports the same.{" "}
      <a href={urls.build(project.slug, source.build.id)}>Open that build</a>
    </Alert>
  );
}

function SourceTerms({
  project,
  source,
}: {
  project: Project;
  source: SkipSource;
}): ReturnType<typeof Meta> {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const from = source.build;
  return (
    <dl class={termList}>
      <dt>Source build</dt>
      <dd>
        {from ? (
          <>
            <a href={urls.build(project.slug, from.id)}>
              {from.gitBranch} · {from.gitSha.slice(0, 7)}
            </a>{" "}
            <Badge tone={statusTone(from.status)} icon>
              {from.status}
            </Badge>
          </>
        ) : (
          "No longer available"
        )}
      </dd>
      <dt>Storybook</dt>
      <dd>
        {from && source.storybook ? (
          <a href={urls.short(from.id)}>Open source Storybook</a>
        ) : (
          "No longer available"
        )}
      </dd>
    </dl>
  );
}

function ExplanationCard({
  project,
  build,
  source,
}: {
  project: Project;
  build: Build;
  source: SkipSource;
}): ReturnType<typeof Card> {
  const sha = skipSourceSha(build, source);
  const from = source.build;
  return (
    <Card>
      <VStack>
        <SectionTitle>{noStoryChangedText(sha)}</SectionTitle>
        <SourceAlert project={project} source={source} />
        <Meta>
          StoryShelf compared this commit with the last approved build on{" "}
          <code>{from?.gitBranch ?? build.gitBranch}</code> and found that none of its stories can
          reach a changed file, so nothing was uploaded or captured. This commit&apos;s check
          repeats that build&apos;s result.
        </Meta>
        <SourceTerms project={project} source={source} />
      </VStack>
    </Card>
  );
}

function FileItem({ path }: { path: string }): ReturnType<typeof Meta> {
  return (
    <li>
      <code>{path}</code>
    </li>
  );
}

function ChangedFilesCard({ files }: { files: string[] }): ReturnType<typeof Card> {
  return (
    <Card>
      <VStack>
        <SectionTitle>Changed files ({files.length})</SectionTitle>
        {files.length === 0 ? <Meta>No changed files were recorded.</Meta> : null}
        <ul class={fileList}>
          {files.slice(0, VISIBLE_FILES).map((path) => (
            <FileItem key={path} path={path} />
          ))}
        </ul>
        {files.length > VISIBLE_FILES ? (
          <details>
            <summary>Show all {files.length}</summary>
            <ul class={fileList}>
              {files.slice(VISIBLE_FILES).map((path) => (
                <FileItem key={path} path={path} />
              ))}
            </ul>
          </details>
        ) : null}
      </VStack>
    </Card>
  );
}

/**
 * The page of a `skipped` build (ADR 0044): header, one explanation card and the changed files.
 * It never shows snapshots, tests, a verdict or capture controls, because the build has none.
 */
export async function renderSkippedBuildPage(
  project: Project,
  build: Build,
): Promise<RenderedContent> {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const source = await loadSkipSource(build);
  const sha = build.gitSha.slice(0, 7);
  return (
    <DocumentLayout
      title={`Build ${build.gitBranch}`}
      nav={{
        active: "builds",
        projectSlug: project.slug,
        projectName: project.name,
        trail: [{ label: `${build.gitBranch} · ${sha}` }],
      }}
    >
      <PageHeader
        title={
          <>
            {build.gitBranch} <Meta as="span">· {sha}</Meta> <Badge tone="neutral">skipped</Badge>
          </>
        }
        description={
          <>
            {build.message ?? "No message"}{" "}
            {build.authorName
              ? `· ${build.authorName}${build.authorEmail ? ` <${build.authorEmail}>` : ""}`
              : ""}{" "}
            · {new Date(build.createdAt).toLocaleString()}
          </>
        }
        actions={
          source.build && source.storybook ? (
            <Button variant="secondary" href={urls.short(source.build.id)}>
              View source Storybook
            </Button>
          ) : null
        }
      />
      <VStack>
        <ExplanationCard project={project} build={build} source={source} />
        <ChangedFilesCard files={changedFilesOf(build)} />
      </VStack>
    </DocumentLayout>
  );
}
