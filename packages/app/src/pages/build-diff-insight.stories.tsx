// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import type { HealthPanelData } from "../insights/health-panel.ts";
import type { InsightPanelData } from "../insights/panel.ts";
import type { InsightView } from "../insights/view.ts";
import { BUILD_REVIEW, builds, project } from "../stories-fixtures/dataset.ts";
import { hoursAgo } from "../stories-fixtures/time.ts";
import { InsightPanel } from "./build-diff-insight.tsx";
import { HealthPanel } from "./health-panel.tsx";

const meta: Meta = { title: "Pages/Builds/AI panels" };
export default meta;

const view = (kind: string, output: unknown): InsightView => ({
  id: `insight-${kind}`,
  kind,
  buildId: BUILD_REVIEW,
  window: null,
  status: "done",
  profile: "default",
  model: "claude-sonnet-5-5",
  promptVersion: "1",
  verdict: "needs-review",
  summary: "Two snapshots changed in ways worth a look.",
  output,
  meta: null,
  errorCode: null,
  createdAt: hoursAgo(1),
  startedAt: hoursAgo(1),
  finishedAt: hoursAgo(1),
});

const found = builds.find((candidate) => candidate.id === BUILD_REVIEW);
if (!found) {
  throw new Error("The story dataset has no review build");
}
const build = found;

const triage: InsightPanelData = {
  canGenerate: true,
  latest: view("triage", {
    items: [
      { snapshotKey: "Button / Primary", severity: "medium", note: "The label moved 2px left." },
      { snapshotKey: "Card / Wide", severity: "low", note: "Shadow is slightly lighter." },
    ],
  }),
};

const health: HealthPanelData = {
  canGenerate: true,
  latest: view("health", {
    trends: [
      { label: "Review time", direction: "improving", note: "Median fell from 2 days to 1." },
      { label: "Flaky stories", direction: "worsening", note: "Three stories changed twice." },
    ],
  }),
};

/** The triage list's rows start at the card's own edge, with no bullets or browser indent. */
export const TriageWithTwoItems = jsxStory(() => (
  <InsightPanel project={project} build={build} data={triage} />
));

export const HealthWithTwoTrends = jsxStory(() => <HealthPanel project={project} data={health} />);
