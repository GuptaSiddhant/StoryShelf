import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { HEALTH_UI_WINDOW, type HealthPanelData } from "../insights/health-panel.ts";
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

/** Badge tone for a health verdict. */
export function healthTone(verdict: string | null): "success" | "warning" | "danger" | "neutral" {
  if (verdict === "healthy") {
    return "success";
  }
  if (verdict === "watch") {
    return "warning";
  }
  return verdict === "unhealthy" ? "danger" : "neutral";
}

interface Trend {
  label: string;
  note: string;
  direction: string;
}

function trendsOf(output: unknown): Trend[] {
  const trends = (output as { trends?: unknown } | null)?.trends;
  return Array.isArray(trends) ? (trends as Trend[]) : [];
}

function scoreText(output: unknown): string {
  const score = (output as { score?: unknown } | null)?.score;
  return typeof score === "number" ? ` · score ${Math.round(score)}/100` : "";
}

function HealthBody(props: {
  latest: HealthPanelData["latest"];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { latest } = props;
  if (!latest) {
    return <Meta>No health digest yet for the last {HEALTH_UI_WINDOW}.</Meta>;
  }
  if (latest.status === "failed") {
    return (
      <Alert tone="warning" title="Health digest failed">
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
        {trendsOf(latest.output).map((trend) => (
          <li>
            <strong>{trend.label}</strong> ({trend.direction}): {trend.note}
          </li>
        ))}
      </ul>
      <Meta>
        {latest.profile} · {latest.model} · {latest.createdAt.slice(0, 16).replace("T", " ")}
        {scoreText(latest.output)}
      </Meta>
    </>
  );
}

/** Props for the health panel. */
export interface HealthPanelProps {
  project: Project;
  data: HealthPanelData;
}

/** Project health digest (advisory) with a generate/refresh button for approvers and admins. */
export function HealthPanel(
  props: HealthPanelProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, data } = props;
  const base = `/projects/${project.slug}/insights/health`;
  const latest = data.latest;
  const inFlight = latest?.status === "pending" || latest?.status === "running";
  const poll = inFlight
    ? { "hx-get": `${base}/panel`, "hx-trigger": "load delay:3s", "hx-swap": "outerHTML" }
    : {};
  return (
    <div id="health-panel" {...poll}>
      <Card>
        <HStack>
          <SectionTitle level={3}>Project health (AI, last {HEALTH_UI_WINDOW})</SectionTitle>
          {latest?.status === "done" ? (
            <Badge tone={healthTone(latest.verdict)}>{latest.verdict}</Badge>
          ) : null}
          {inFlight ? <Badge tone="info">generating…</Badge> : null}
        </HStack>
        <VStack>
          <HealthBody latest={latest} />
          {data.canGenerate && !inFlight ? (
            <form
              method="post"
              action={`${base}/generate`}
              hx-post={`${base}/generate`}
              hx-target="#health-panel"
              hx-swap="outerHTML"
            >
              {csrfField()}
              <input type="hidden" name="force" value={latest ? "true" : "false"} />
              <Button variant="secondary" size="sm" type="submit" icon="sparkles">
                {latest ? "Refresh health" : "Generate health"}
              </Button>
            </form>
          ) : null}
        </VStack>
      </Card>
    </div>
  );
}

/** Renders the panel when AI health is available for the project, nothing otherwise. */
export function HealthSlot(props: {
  project: Project;
  data: HealthPanelData | null;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  return props.data ? <HealthPanel project={props.project} data={props.data} /> : null;
}
