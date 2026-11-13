import type { Build, Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { HealthPanelData } from "../insights/health-panel.ts";
import { Card, EmptyState, HStack, Meta, SectionTitle, Stat, VStack } from "../ui/components.tsx";
import type { A11ySummary } from "./a11y-violations.tsx";
import { a11ySummaryNote } from "./a11y-violations.tsx";
import { JobsSection, type QueueView } from "./compute-jobs.tsx";
import { HealthSlot } from "./health-panel.tsx";
import { InheritedRatioCard } from "./inherited-ratio-card.tsx";
import { formatDurationMs, type CaptureTimings } from "./insights-model.ts";

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** What the Insights tab shows; every part is optional because each depends on what the server runs. */
export interface SettingsInsightsData {
  /** Every build of the project, newest first. */
  builds: Build[];
  /** Captures run here (testing on): the numbers and the jobs list need it. */
  testing: boolean;
  /** The AI health digest, or null when AI is off for the project. */
  health: HealthPanelData | null;
  /** The newest build that was captured here, with the numbers measured on it. */
  latest: { build: Build; timings: CaptureTimings | null; a11y: A11ySummary } | null;
  queue: QueueView[];
  canRetry: boolean;
}

function TimingsCard(props: { latest: NonNullable<SettingsInsightsData["latest"]> }): Rendered {
  const { build, timings } = props.latest;
  return (
    <Card>
      <SectionTitle level={3}>Capture timings</SectionTitle>
      {timings ? (
        <>
          <HStack justify="between" wrap>
            <Stat label="Average per snapshot" value={formatDurationMs(timings.averageMs)} />
            <Stat label="95th percentile" value={formatDurationMs(timings.p95Ms)} />
            <Stat label="Slowest" value={formatDurationMs(timings.slowestMs)} />
          </HStack>
          <Meta>
            Over the {timings.measured} snapshots the renderer timed in the newest captured build (
            {build.gitBranch}, {build.gitSha.slice(0, 7)}). Snapshots inherited from a baseline were
            not rendered, so they have no time.
          </Meta>
        </>
      ) : (
        <Meta>The newest captured build has no timed snapshots.</Meta>
      )}
    </Card>
  );
}

function A11yCard(props: { latest: NonNullable<SettingsInsightsData["latest"]> }): Rendered {
  const { a11y } = props.latest;
  return (
    <Card>
      <SectionTitle level={3}>Accessibility findings</SectionTitle>
      <HStack justify="between" wrap>
        <Stat label="Findings" value={a11y.findings} />
        <Stat label="Snapshots with findings" value={a11y.snapshots} />
        <Stat label="From baselines" value={a11y.fromBaseline} />
      </HStack>
      <Meta>Newest captured build. {a11ySummaryNote(a11y)}</Meta>
    </Card>
  );
}

function CaptureNumbers(props: { data: SettingsInsightsData }): Rendered {
  const { data } = props;
  return (
    <>
      <InheritedRatioCard builds={data.builds} />
      {data.latest ? (
        <>
          <TimingsCard latest={data.latest} />
          <A11yCard latest={data.latest} />
        </>
      ) : (
        <EmptyState
          title="No captured builds yet"
          description="Timings and accessibility totals appear once a build has been captured on this server."
        />
      )}
    </>
  );
}

/** Insights tab: the operator numbers (capture reuse, timings, a11y), the AI health digest and the jobs list. */
export function renderSettingsInsights(project: Project, data: SettingsInsightsData): unknown {
  return (
    <VStack>
      <HealthSlot project={project} data={data.health} />
      {data.testing ? (
        <>
          <CaptureNumbers data={data} />
          <JobsSection
            project={project}
            builds={data.builds}
            queue={data.queue}
            canRetry={data.canRetry}
          />
        </>
      ) : null}
    </VStack>
  );
}
