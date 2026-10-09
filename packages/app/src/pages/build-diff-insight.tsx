import type { Build, Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { InsightPanelData } from "../insights/panel.ts";
import {
  Alert,
  Badge,
  Button,
  Card,
  HStack,
  Meta,
  SectionTitle,
  VStack,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

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
      <ul>
        {itemsOf(latest.output).map((item) => (
          <li>
            <strong>{item.snapshotKey}</strong> ({item.severity}): {item.note}
          </li>
        ))}
      </ul>
      <Meta>
        {latest.profile} · {latest.model} · {latest.createdAt.slice(0, 16).replace("T", " ")}
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
          <SectionTitle level={3}>AI triage (advisory)</SectionTitle>
          {latest?.status === "done" ? (
            <Badge tone={verdictTone(latest.verdict)}>{latest.verdict}</Badge>
          ) : null}
          {inFlight ? <Badge tone="info">generating…</Badge> : null}
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
