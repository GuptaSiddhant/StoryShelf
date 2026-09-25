import type { ShelfConfig } from "@storyshelf/core/config";
import type { HtmlEscapedString } from "hono/utils/html";
import type { HealthReport } from "../routers/health-report.ts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Meta,
  PageHeader,
  SectionTitle,
  Stat,
} from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Data for the site-admin System page (adapters, health, safe config). */
export interface AdminSystemData {
  report: HealthReport;
  authEnabled: boolean;
  config: ShelfConfig;
}

function healthTone(state: string): "success" | "info" | "danger" | "neutral" {
  if (state === "ok") {
    return "success";
  }
  if (state === "starting") {
    return "info";
  }
  if (state === "failed" || state === "degraded") {
    return "danger";
  }
  return "neutral";
}

function formatUptime(uptimeSecs: number): string {
  if (uptimeSecs < 60) {
    return `${uptimeSecs}s`;
  }
  const minutes = Math.floor(uptimeSecs / 60);
  if (minutes < 60) {
    return `${minutes}m ${uptimeSecs % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatLatency(latencyMs: number | undefined): string {
  return latencyMs === undefined ? "—" : `${latencyMs} ms`;
}

function formatOptional(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === "") {
    return "—";
  }
  return String(value);
}

/** One adapter row: identity, version, live probe state, latency, detail. */
function AdapterRow(props: {
  adapter: HealthReport["adapters"][number];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { adapter } = props;
  return (
    <tr key={`${adapter.category}/${adapter.kind}`}>
      <td>
        <strong>{adapter.name}</strong>
        {adapter.description ? <Meta as="div">{adapter.description}</Meta> : null}
        {adapter.hasLifecycle ? null : <Meta as="div">No lifecycle hooks</Meta>}
      </td>
      <td>
        <Meta as="span">{adapter.category}</Meta>
      </td>
      <td>
        <Meta as="span" mono>
          {adapter.kind}
        </Meta>
      </td>
      <td>
        <Meta as="span" mono>
          {adapter.version}
        </Meta>
      </td>
      <td>
        <Badge tone={healthTone(adapter.state)}>{adapter.state}</Badge>
      </td>
      <td class="nowrap">
        <Meta as="span">{formatLatency(adapter.latencyMs)}</Meta>
      </td>
      <td>
        <Meta as="span">{adapter.detail ?? "—"}</Meta>
      </td>
    </tr>
  );
}

interface AdapterTableProps {
  report: HealthReport;
}

/** Adapter inventory with live health states. */
function AdapterTable(props: AdapterTableProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { report } = props;
  if (report.adapters.length === 0) {
    return <EmptyState description="No adapters wired." />;
  }
  return (
    <div class="table-wrap table-gap">
      <table>
        <thead>
          <tr>
            <th>Adapter</th>
            <th>Category</th>
            <th>Kind</th>
            <th>Version</th>
            <th>Health</th>
            <th>Latency</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {report.adapters.map((adapter) => (
            <AdapterRow key={`${adapter.category}/${adapter.kind}`} adapter={adapter} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ServerFactsProps {
  report: HealthReport;
  authEnabled: boolean;
  config: ShelfConfig;
}

/** Non-secret server facts (never secret, admin token, or credentials). */
function ServerFacts(props: ServerFactsProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { report, authEnabled, config } = props;
  return (
    <Card>
      <SectionTitle>Server</SectionTitle>
      <div class="grid grid--3">
        <Stat label="Status" value={report.status} />
        <Stat label="Uptime" value={formatUptime(report.uptimeSecs)} />
        <Stat label="Version" value={report.version} />
      </div>
      <Meta>
        Auth {authEnabled ? "enabled" : "disabled — all operations permitted"} · Capture concurrency{" "}
        {formatOptional(config.captureConcurrency)} · Purge TTL{" "}
        {formatOptional(config.purgeTtlDays)} days · Branch TTL{" "}
        {config.branchTtlDays === null
          ? "disabled"
          : `${formatOptional(config.branchTtlDays)} days`}
      </Meta>
      <Meta>
        Scratch dir {formatOptional(config.scratchDir)} · Published domain{" "}
        {formatOptional(config.publishedBaseDomain)} · Max upload{" "}
        {formatOptional(config.maxUploadBytes)} bytes
      </Meta>
    </Card>
  );
}

/** Site-admin System page: adapter inventory with in-depth health. */
export function renderAdminSystemPage(data: AdminSystemData): RenderedContent {
  const { report, authEnabled, config } = data;
  return (
    <DocumentLayout title="System" nav={{ active: "admin" }}>
      <PageHeader
        title="System"
        description="Adapter inventory with in-depth health. Visible to site admins only."
        meta={
          <>
            {report.adapters.length} adapters · {report.status} · up{" "}
            {formatUptime(report.uptimeSecs)}
          </>
        }
        actions={
          <Button variant="secondary" size="sm" href="/admin">
            Recheck
          </Button>
        }
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: "System" }]}
      />
      <ServerFacts report={report} authEnabled={authEnabled} config={config} />
      <div class="mt-1">
        <Card>
          <SectionTitle>Adapters</SectionTitle>
          <Meta>
            Live probe per adapter (2s timeout, parallel). Setup failures surface as failed rows;
            adapters without lifecycle hooks report their wired state.
          </Meta>
          <AdapterTable report={report} />
        </Card>
      </div>
    </DocumentLayout>
  );
}
