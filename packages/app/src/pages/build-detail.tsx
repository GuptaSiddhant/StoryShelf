import { groupComponents, parseTestResults } from "@storyshelf/core/capture";
import { BuildModel } from "@storyshelf/core/models";
import { CaptureAttemptModel } from "@storyshelf/core/models";
import { CaptureLogModel } from "@storyshelf/core/models";
import { LabelModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { SnapshotModel } from "@storyshelf/core/models";
import { CANCELLABLE_BUILD_STATUSES } from "@storyshelf/core/types";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import { loadBaselineView } from "../routers/baseline-guard.ts";
import {
  designUrlsFor,
  loadDesignResolutions,
  providerNameFor,
} from "../routers/design.handlers.ts";
import { loadReviewSection } from "../routers/review-section.handlers.ts";
import { catalogOf, getStore, testingEnabled } from "../store.ts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Meta,
  PageHeader,
  SectionTitle,
  Stat,
  Thumbnail,
  VStack,
  statusTone,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import {
  snapshotCard,
  snapshotCardBody,
  snapshotCardHead,
  snapshotCardMeta,
  snapshotGrid,
} from "../ui/styles/review.ts";
import { a11ySummaryNote, a11ySummaryOf } from "./a11y-violations.tsx";
import { snapshotVariant } from "./build-diff-model.ts";
import { StaleBaselineNotice } from "./build-diff-stale.tsx";
import { LinkedUsage, type LinkedUsageItem } from "./build-diff-usage.tsx";
import { TestsCard } from "./build-tests.tsx";
import { DesignButtons } from "./design-links.tsx";
import { ChangesetCard } from "./review-changeset.tsx";
import { CommentsCard } from "./review-comments.tsx";
import { VerdictCard } from "./review-verdict.tsx";

/** Map a capture log level to its badge tone. */
function logTone(level: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (level === "error") {
    return "danger";
  }
  if (level === "warn") {
    return "warning";
  }
  if (level === "info") {
    return "info";
  }
  return "neutral";
}
/** Build overview page: snapshot grid, bulk actions, and build comments. */
export async function renderBuildDetailPage(
  buildId: string,
  usageByStory: Map<string, LinkedUsageItem[]> = new Map(),
): Promise<RenderedContent | null> {
  const { db } = getStore();
  const build = await new BuildModel(db).get(buildId);
  if (!build) {
    return null;
  }
  const project = await new ProjectModel(db).get(build.projectId);
  if (!project) {
    return null;
  }
  const snapshots = await new SnapshotModel(db).listByBuild(build.id);
  const attempts = await new CaptureAttemptModel(db).listByBuild(build.id);
  const logs = new CaptureLogModel(db);
  const attemptLogs = new Map<string, Awaited<ReturnType<typeof logs.listByAttempt>>>();
  /* oxlint-disable-next-line eslint/no-await-in-loop -- attempts are few; sequential reads keep code simple */
  for (const attempt of attempts) {
    attemptLogs.set(attempt.id, await logs.listByAttempt(attempt.id));
  }
  const canReview = !getStore().authEnabled || Boolean(getStore().user);
  const { drifted } = await loadBaselineView(project, build, snapshots);
  const designs = await loadDesignResolutions(project, snapshots).catch(() => new Map());
  const staleCount = Object.keys(drifted).length;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const testing = testingEnabled();
  const cancelled = build.status === "cancelled";
  const published = build.status === "approved" && attempts.length === 0;
  const [catalog, labels] = await Promise.all([
    catalogOf()
      .load(project.id, build.id)
      .catch(() => null),
    new LabelModel(db).listForBuild(build.id),
  ]);
  const review = await loadReviewSection(project, build, catalog);
  const components = catalog ? groupComponents(catalog.entries) : [];
  const storyCount = catalog?.entries.filter((entry) => entry.type === "story").length ?? 0;

  const grouped = new Map<string, typeof snapshots>();
  for (const snap of snapshots) {
    const key = snap.status;
    const list = grouped.get(key) ?? [];
    list.push(snap);
    grouped.set(key, list);
  }
  const a11y = a11ySummaryOf(snapshots);
  const selective = build.affectedOnly && build.affectedImportPaths !== null;

  return (
    <DocumentLayout
      title={`Build ${build.gitBranch}`}
      nav={{
        active: "builds",
        projectSlug: project.slug,
        projectName: project.name,
        trail: [{ label: `${build.gitBranch} · ${build.gitSha.slice(0, 7)}` }],
      }}
    >
      <PageHeader
        title={
          <>
            {build.gitBranch} <Meta as="span">· {build.gitSha.slice(0, 7)}</Meta>{" "}
            <Badge tone={statusTone(build.status)}>{published ? "Published" : build.status}</Badge>
            {testing && selective ? (
              <>
                {" "}
                <Badge tone="info">affected capture</Badge>
              </>
            ) : null}
            {testing && !build.affectedOnly ? (
              <>
                {" "}
                <Badge tone="neutral">full capture</Badge>
              </>
            ) : null}
            {labels.map((label): HtmlEscapedString | Promise<HtmlEscapedString> => (
              <span key={`${label.typeKey}:${label.value}`}>
                {" "}
                <Badge tone="neutral">
                  {label.typeKey}: {label.value}
                </Badge>
              </span>
            ))}
          </>
        }
        description={
          <>
            {build.message ?? "No message"}{" "}
            {build.authorName
              ? `· ${build.authorName}${build.authorEmail ? ` <${build.authorEmail}>` : ""}`
              : ""}{" "}
            · {new Date(build.createdAt).toLocaleString()}
            {testing && selective ? (
              <>
                {" "}
                · {build.snapshotCount - build.inheritedCount} rendered, {build.inheritedCount}{" "}
                inherited
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {testing ? (
              <Button variant="primary" href={urls.buildDiff(project.slug, build.id)}>
                Review diffs
              </Button>
            ) : null}
            <Button variant={testing ? "ghost" : "primary"} href={urls.short(build.id)}>
              View Storybook
            </Button>
            {testing ? (
              <form
                method="post"
                action={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`}
                hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/retry`}
                hx-target="body"
              >
                <Button variant="secondary" type="submit">
                  Retry capture
                </Button>
              </form>
            ) : null}
            {testing && CANCELLABLE_BUILD_STATUSES.includes(build.status) ? (
              <form
                method="post"
                action={`/api/v1/projects/${project.slug}/builds/${build.id}/cancel`}
                hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/cancel`}
                hx-target="body"
              >
                <Button variant="danger" size="sm" type="submit">
                  Cancel build
                </Button>
              </form>
            ) : null}
          </>
        }
      />

      {testing && staleCount > 0 ? (
        <StaleBaselineNotice
          project={project}
          build={build}
          staleCount={staleCount}
          canReview={canReview}
        />
      ) : null}

      <div class="mb-1">
        <div class="grid grid--3">
          {catalog ? (
            <>
              <Card>
                <Stat label="Components" value={components.length} />
              </Card>
              <Card>
                <Stat label="Stories" value={storyCount} />
              </Card>
            </>
          ) : null}
          {testing ? (
            <>
              <Card>
                <Stat label="Snapshots" value={snapshots.length} />
              </Card>
              <Card>
                <Stat label="Inherited" value={build.inheritedCount} />
                <Meta>Reused from the baseline without rendering.</Meta>
              </Card>
              <Card>
                <Stat label="Changed / new" value={build.changedCount} tone="warning" />
              </Card>
              <Card>
                <Stat label="Approved / unchanged" value={build.approvedCount} tone="success" />
              </Card>
              <Card>
                <Stat
                  label="Accessibility findings"
                  value={a11y.findings}
                  tone={a11y.findings > 0 ? "warning" : "neutral"}
                />
                <Meta>{a11ySummaryNote(a11y)}</Meta>
              </Card>
            </>
          ) : null}
        </div>
      </div>

      {testing && attempts.length > 0 ? (
        <Card>
          <SectionTitle>Capture attempts</SectionTitle>
          {attempts.map((attempt, index): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <details key={attempt.id} open={index === attempts.length - 1}>
              <summary>
                Attempt {attempt.attemptNo}{" "}
                <Badge tone={statusTone(attempt.status)}>{attempt.status}</Badge>{" "}
                <Meta as="span">
                  {attempt.storyCount} stories
                  {attempt.reqId ? ` · ${attempt.reqId}` : ""}
                </Meta>
              </summary>
              {attempt.error ? <Meta as="pre">{attempt.error}</Meta> : null}
              <div class="mt-1">
                <VStack>
                  {(attemptLogs.get(attempt.id) ?? []).map(
                    (line): HtmlEscapedString | Promise<HtmlEscapedString> => (
                      <HStack key={line.id} align="baseline" wrap={false}>
                        <Badge tone={logTone(line.level)}>{line.level}</Badge>
                        <span>{line.message}</span>
                        {line.fields ? <Meta as="code">{line.fields}</Meta> : null}
                      </HStack>
                    ),
                  )}
                </VStack>
              </div>
            </details>
          ))}
        </Card>
      ) : null}

      <TestsCard results={parseTestResults(build.testResults)} />

      {testing && canReview && (build.status === "reviewing" || build.status === "comparing") ? (
        <div class="mb-1">
          <Card>
            <HStack>
              <Meta as="span">Bulk actions:</Meta>
              <form
                method="post"
                action={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`}
                hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`}
                hx-target="body"
                hx-confirm="Approve all remaining changes?"
                data-toast="Approved all remaining changes"
              >
                <Button variant="primary" size="sm" type="submit">
                  Approve all
                </Button>
              </form>
              <form
                method="post"
                action={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
                hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
                hx-target="body"
                hx-confirm="Reject all remaining changes?"
                data-toast="Rejected all remaining changes"
                data-toast-tone="warning"
              >
                <Button variant="danger" size="sm" type="submit">
                  Reject all
                </Button>
              </form>
              <Meta as="span">Or review individually in the diff view.</Meta>
            </HStack>
          </Card>
        </div>
      ) : null}

      {review ? (
        <div class="mb-1">
          <VStack>
            {testing || cancelled ? null : <VerdictCard data={review} />}
            <ChangesetCard data={review} />
          </VStack>
        </div>
      ) : null}

      {!testing ? null : snapshots.length === 0 ? (
        <EmptyState
          title="No snapshots yet"
          description="Capture is pending or failed. Try retrying capture."
        />
      ) : (
        <div class={snapshotGrid}>
          {snapshots.map((snap): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <div key={snap.id} class={snapshotCard}>
              <div class={snapshotCardHead}>
                <Badge tone={statusTone(snap.status)}>{snap.status}</Badge>
                {snap.inherited ? (
                  <>
                    {" "}
                    <Badge tone="neutral">inherited</Badge>
                  </>
                ) : null}
                <span class={snapshotCardMeta}>
                  {snapshotVariant(snap)} · {snap.viewportWidth}×{snap.viewportHeight}
                </span>
              </div>
              <div class={snapshotCardBody}>
                <a href={`${urls.buildDiff(project.slug, build.id)}?snapshot=${snap.id}`}>
                  <Thumbnail
                    src={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/image`}
                    alt={`${snap.storyTitle} / ${snap.storyName}`}
                  />
                </a>
                <SectionTitle>
                  {snap.storyTitle} <Meta as="span">/ {snap.storyName}</Meta>
                </SectionTitle>
                <Meta as="div">
                  {snap.storyId}
                  {snap.diffRatio !== null && snap.diffRatio !== undefined
                    ? ` · diff ${(snap.diffRatio * 100).toFixed(2)}%`
                    : ""}
                  {snap.diffPixels === null || snap.diffPixels === undefined
                    ? ""
                    : ` · ${snap.diffPixels} px`}
                </Meta>
                {snap.storyImportPath && usageByStory.has(snap.storyImportPath) ? (
                  <LinkedUsage
                    usage={usageByStory.get(snap.storyImportPath) ?? []}
                    publishedBaseDomain={getStore().config.publishedBaseDomain}
                  />
                ) : null}
                <HStack>
                  <Button
                    variant="secondary"
                    size="sm"
                    href={`${urls.buildDiff(project.slug, build.id)}?snapshot=${snap.id}`}
                  >
                    Review
                  </Button>
                  <Button variant="ghost" size="sm" href={urls.short(build.id)}>
                    View Storybook
                  </Button>
                  {snap.storyImportPath ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      href={`${urls.component(project.slug, snap.storyImportPath)}#${snap.storyId}`}
                    >
                      Component
                    </Button>
                  ) : null}
                  <DesignButtons
                    urls={designUrlsFor(designs, snap)}
                    providerName={providerNameFor}
                  />
                  {canReview && (snap.status === "new" || snap.status === "changed") ? (
                    <>
                      <form
                        method="post"
                        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/approve`}
                        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/approve`}
                        hx-target="body"
                        data-toast={`Approved ${snap.storyName}`}
                      >
                        <Button variant="ghost" size="sm" type="submit">
                          Approve
                        </Button>
                      </form>
                      <form
                        method="post"
                        action={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/reject`}
                        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snap.id}/reject`}
                        hx-target="body"
                        data-toast={`Rejected ${snap.storyName}`}
                        data-toast-tone="warning"
                      >
                        <Button variant="ghost" size="sm" type="submit">
                          Reject
                        </Button>
                      </form>
                    </>
                  ) : null}
                </HStack>
              </div>
            </div>
          ))}
        </div>
      )}

      {review ? (
        <div class="mt-1">
          <VStack>
            {testing && !cancelled ? <VerdictCard data={review} /> : null}
            <CommentsCard data={review} />
          </VStack>
        </div>
      ) : null}
    </DocumentLayout>
  );
}
