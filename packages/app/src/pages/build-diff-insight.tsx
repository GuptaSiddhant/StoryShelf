import type { Build, Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { InsightPanelData } from "../insights/panel.ts";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  HStack,
  Meta,
  SectionTitle,
  VStack,
  statusLabel,
  RelativeTime,
} from "../ui/components.tsx";
interface TriageItem {
  snapshotKey: string;
  note: string;
  severity: string;
}

function itemsOf(output: unknown): TriageItem[] {
  const items = (output as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as TriageItem[]) : [];
}

function verdictTone(verdict: string | null): "success" | "warning" | "danger" | "neutral" {
  if (verdict === "likely-intended") {
    return "success";
  }
  if (verdict === "needs-review") {
    return "warning";
  }
  return verdict === "likely-regression" ? "danger" : "neutral";
}

function InsightBody(props: {
  latest: InsightPanelData["latest"];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { latest } = props;
  if (!latest) {
    return <Meta>No AI triage yet for this build.</Meta>;
  }
  if (latest.status === "failed") {
    return (
      <Alert tone="warning" title="Triage failed">
        The model call did not finish ({latest.errorCode}). You can try again.
      </Alert>
    );
  }
  if (latest.status !== "done") {
    return <Meta>Working on it…</Meta>;
  }
  return (
    <>
      <span>{latest.summary}</span>
      <VStack gap="sm">
        {itemsOf(latest.output).map((item) => (
          <div key={item.snapshotKey}>
            <strong>{item.snapshotKey}</strong> ({statusLabel(item.severity)}): {item.note}
          </div>
        ))}
      </VStack>
      <Meta>
        {latest.profile} · {latest.model} · <RelativeTime value={latest.createdAt} />
      </Meta>
    </>
  );
}

/** Props for the AI triage panel on the build review page. */
export interface InsightPanelProps {
  project: Project;
  build: Build;
  data: InsightPanelData;
}

/** AI triage panel: verdict, summary, per-snapshot notes (plain text) and regenerate. */
export function InsightPanel(
  props: InsightPanelProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, data } = props;
  const base = `/projects/${project.slug}/builds/${build.id}/insights`;
  const latest = data.latest;
  const inFlight = latest?.status === "pending" || latest?.status === "running";
  const poll = inFlight
    ? { "hx-get": `${base}/panel`, "hx-trigger": "load delay:3s", "hx-swap": "outerHTML" }
    : {};
  return (
    <div id="insight-panel" {...poll}>
      <Card>
        <HStack>
          <SectionTitle>AI triage (advisory)</SectionTitle>
          {latest?.status === "done" ? (
            <Badge tone={verdictTone(latest.verdict)}>{statusLabel(latest.verdict ?? "")}</Badge>
          ) : null}
          {inFlight ? <Badge tone="info">Generating…</Badge> : null}
        </HStack>
        <VStack>
          <InsightBody latest={latest} />
          {data.canGenerate && !inFlight ? (
            <form
              method="post"
              action={`${base}/generate`}
              hx-post={`${base}/generate`}
              hx-target="#insight-panel"
              hx-swap="outerHTML"
            >
              {csrfField()}
              <input type="hidden" name="force" value={latest ? "true" : "false"} />
              <Button variant="secondary" size="sm" type="submit" icon="sparkles">
                {latest ? "Regenerate" : "Generate triage"}
              </Button>
            </form>
          ) : null}
        </VStack>
      </Card>
    </div>
  );
}

/** Renders the panel when AI triage is available for the project, nothing otherwise. */
export function InsightSlot(props: {
  project: Project;
  build: Build;
  data: InsightPanelData | null | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  return props.data ? (
    <InsightPanel project={props.project} build={props.build} data={props.data} />
  ) : null;
}
