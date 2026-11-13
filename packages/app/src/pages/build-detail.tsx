import { groupComponents, parseTestResults } from "@storyshelf/core/capture";
import { CaptureAttemptModel, CaptureLogModel, LabelModel } from "@storyshelf/core/models";
import type { Build, CaptureAttempt, CaptureLog, Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { loadReviewSection, type ReviewSectionData } from "../routers/review-section.handlers.ts";
import { catalogOf, getStore, testingEnabled } from "../store.ts";
import {
  Badge,
  Card,
  DefinitionList,
  Disclosure,
  HStack,
  Meta,
  SectionTitle,
  VStack,
  statusLabel,
  statusTone,
} from "../ui/components.tsx";
import { a11ySummaryNote, type A11ySummary } from "./a11y-violations.tsx";
import { StaleBaselineNotice } from "./build-diff-stale.tsx";
import { TestsCard } from "./build-tests.tsx";
import { ChangeRequestsCard } from "./review-change-requests.tsx";
import { ChangesetCard } from "./review-changeset.tsx";
import { CommentsCard } from "./review-comments.tsx";
import { VerdictCard } from "./review-verdict.tsx";

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Everything the build page's details panel and header read besides the snapshots. */
export interface BuildDetailsData {
  /** Whether capture is on; off, the page is review only. */
  testing: boolean;
  /** An accepted build that was uploaded without capture. */
  published: boolean;
  labels: { typeKey: string; value: string }[];
  /** Catalog counts; null when the build has no catalog. */
  components: number | null;
  stories: number | null;
  attempts: { attempt: CaptureAttempt; logs: CaptureLog[] }[];
  /** Review section; null while the project has review off. */
  review: ReviewSectionData | null;
}

/** Load what the build page needs beyond the snapshots (attempts, labels, catalog, review). */
export async function loadBuildDetails(project: Project, build: Build): Promise<BuildDetailsData> {
  const { db } = getStore();
  const logs = new CaptureLogModel(db);
  const attempts = await new CaptureAttemptModel(db).listByBuild(build.id).catch(() => []);
  const withLogs = await Promise.all(
    attempts.map(async (attempt) => ({
      attempt,
      logs: await logs.listByAttempt(attempt.id).catch(() => []),
    })),
  );
  const [catalog, labels] = await Promise.all([
    catalogOf()
      .load(project.id, build.id)
      .catch(() => null),
    new LabelModel(db).listForBuild(build.id).catch(() => []),
  ]);
  return {
    testing: testingEnabled(),
    published: build.status === "approved" && attempts.length === 0,
    labels,
    components: catalog ? groupComponents(catalog.entries).length : null,
    stories: catalog ? catalog.entries.filter((entry) => entry.type === "story").length : null,
    attempts: withLogs,
    review: await loadReviewSection(project, build, catalog).catch(() => null),
  };
}

/** Map a capture log level to its badge tone. */
function logTone(level: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (level === "error") {
    return "danger";
  }
  if (level === "warn") {
    return "warning";
  }
  return level === "info" ? "info" : "neutral";
}

function AttemptsCard(props: { attempts: BuildDetailsData["attempts"] }): Rendered | null {
  const { attempts } = props;
  if (attempts.length === 0) {
    return null;
  }
  return (
    <Card>
      <SectionTitle>Capture attempts</SectionTitle>
      {attempts.map(({ attempt, logs }, index): Rendered => (
        <details key={attempt.id} open={index === attempts.length - 1}>
          <summary>
            Attempt {attempt.attemptNo}{" "}
            <Badge tone={statusTone(attempt.status)}>{statusLabel(attempt.status)}</Badge>{" "}
            <Meta as="span">
              {attempt.storyCount} stories
              {attempt.reqId ? ` · ${attempt.reqId}` : ""}
            </Meta>
          </summary>
          {attempt.error ? <Meta as="pre">{attempt.error}</Meta> : null}
          <div class="mt-1">
            <VStack>
              {logs.map((line): Rendered => (
                <HStack key={line.id} align="baseline" wrap={false}>
                  <Badge tone={logTone(line.level)}>{line.level}</Badge>
                  <span>{line.message}</span>
                  {line.fields ? <Meta as="code">{line.fields}</Meta> : null}
                </HStack>
              ))}
            </VStack>
          </div>
        </details>
      ))}
    </Card>
  );
}

/** The build's numbers as label/value pairs (capture counts only with capture on). */
export function detailItems(
  build: Build,
  details: BuildDetailsData,
  snapshotCount: number,
  a11y: A11ySummary,
): { label: string; value: string | number; note?: string }[] {
  const catalog =
    details.components === null || details.stories === null
      ? []
      : [
          { label: "Components", value: details.components },
          { label: "Stories", value: details.stories },
        ];
  if (!details.testing) {
    return catalog;
  }
  return [
    ...catalog,
    { label: "Snapshots", value: snapshotCount },
    { label: "Inherited (reused without rendering)", value: build.inheritedCount },
    { label: "Changed / new", value: build.changedCount },
    { label: "Approved / unchanged", value: build.approvedCount },
    { label: "Accessibility findings", value: a11y.findings, note: a11ySummaryNote(a11y) },
  ].filter((item) => Boolean(item.value) || item.label === "Accessibility findings");
}

/** Captured-how line: affected or full capture, and the labels. */
function BuildTags(props: { build: Build; details: BuildDetailsData }): Rendered {
  const { build, details } = props;
  const selective = build.affectedOnly && build.affectedImportPaths !== null;
  return (
    <HStack>
      {details.testing ? (
        <Badge tone={selective ? "info" : "neutral"}>
          {selective ? "affected capture" : "full capture"}
        </Badge>
      ) : null}
      {details.labels.map((label): Rendered => (
        <Badge key={`${label.typeKey}:${label.value}`} tone="neutral">
          {label.typeKey}: {label.value}
        </Badge>
      ))}
    </HStack>
  );
}

interface BuildDetailsProps {
  project: Project;
  build: Build;
  details: BuildDetailsData;
  snapshotCount: number;
  a11y: A11ySummary;
  staleCount: number;
  canReview: boolean;
  tests: ReturnType<typeof parseTestResults>;
}

/** The collapsed details panel: numbers, changes, stale baseline, tests, attempts, review state. */
export function BuildDetails(props: BuildDetailsProps): Rendered {
  const { project, build, details, staleCount, canReview } = props;
  const { review } = details;
  return (
    <Disclosure title="Build details" open={build.status === "failed"}>
      <VStack>
        <BuildTags build={build} details={details} />
        <DefinitionList items={detailItems(build, details, props.snapshotCount, props.a11y)} />
        {details.testing && staleCount > 0 ? (
          <StaleBaselineNotice
            project={project}
            build={build}
            staleCount={staleCount}
            canReview={canReview}
          />
        ) : null}
        {review ? <ChangesetCard data={review} /> : null}
        <TestsCard results={props.tests} />
        <AttemptsCard attempts={details.attempts} />
        {review && details.testing ? <VerdictCard data={review} /> : null}
        {review ? <ChangeRequestsCard data={review} /> : null}
        {review && details.testing ? <CommentsCard data={review} /> : null}
      </VStack>
    </Disclosure>
  );
}

/** Review-only builds (capture off) keep the verdict and discussion in view, not behind the panel. */
export function ReviewOnlySection(props: { details: BuildDetailsData }): Rendered | null {
  const { review, testing } = props.details;
  return review && !testing ? (
    <VStack>
      <VerdictCard data={review} />
      <CommentsCard data={review} />
    </VStack>
  ) : null;
}
