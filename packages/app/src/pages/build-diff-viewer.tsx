import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, CompareStage, Segmented, VStack, statusTone } from "../ui/components.tsx";
import { viewerHead, viewerMeta, viewerTitle } from "../ui/styles/review-layout.ts";
import {
  diffPercent,
  snapshotImageUrl,
  snapshotPageUrl,
  snapshotVariant,
} from "./build-diff-model.ts";
import { StaleSnapshotNotice } from "./build-diff-stale.tsx";
import { LinkedUsage, type LinkedUsageItem } from "./build-diff-usage.tsx";
import { DesignStrip, type DesignItem } from "./design-links.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Viewer props for the selected snapshot. */
export interface DiffViewerProps {
  project: Project;
  build: Build;
  selected: Snapshot;
  /** The selected story/mode's snapshots on every engine (browser tabs when more than one). */
  siblings?: Snapshot[];
  hasBaseline: Record<string, boolean>;
  /** Set when the baseline changed after this snapshot's diff was computed. */
  drifted?: "stale" | "removed";
  /** Linked packages the story uses (provenance badges + upstream deep links). */
  usage?: LinkedUsageItem[];
  /** Resolved design links of the story's component (open-in-Figma + stale/deleted notices). */
  design?: DesignItem[];
  publishedBaseDomain?: string;
}

/** Why a snapshot has no diff image, phrased for the empty pane. */
function diffEmptyText(status: string): string {
  return status === "unchanged" || status === "approved"
    ? "No diff — within threshold"
    : "No diff yet";
}

/** Browser tabs (one link per engine) when the story/mode was captured on several. */
function BrowserTabs(props: {
  project: Project;
  build: Build;
  selected: Snapshot;
  siblings: Snapshot[];
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { project, build, selected, siblings } = props;
  if (siblings.length < 2) return null;
  return (
    <Segmented
      label="Browser"
      data-browser-tabs
      items={siblings.map((snap) => ({
        label: `${snap.browser ?? "chromium"} · ${snap.status}`,
        value: snap.id,
        href: snapshotPageUrl(project, build, snap.id),
        active: snap.id === selected.id,
      }))}
    />
  );
}

/** Story heading plus the comparison stage for the selected snapshot. */
export function DiffViewer(props: DiffViewerProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, hasBaseline, drifted, usage, design, publishedBaseDomain } =
    props;
  const siblings = props.siblings ?? [selected];
  const percent = diffPercent(selected);
  return (
    <VStack>
      <div class={viewerHead}>
        <h2 class={viewerTitle}>
          {selected.storyTitle} / {selected.storyName}
        </h2>
        <p class={viewerMeta}>
          <Badge tone={statusTone(selected.status)} icon>
            {selected.status}
          </Badge>
          <span>
            {snapshotVariant(selected)} · {selected.viewportWidth}×{selected.viewportHeight}
          </span>
          {selected.diffPixels === null || selected.diffPixels === undefined ? null : (
            <span class="mono">{selected.diffPixels} px</span>
          )}
          {percent ? <span class="mono">{percent}</span> : null}
        </p>
      </div>
      <BrowserTabs project={project} build={build} selected={selected} siblings={siblings} />
      {drifted ? <StaleSnapshotNotice status={drifted} /> : null}
      {usage && usage.length > 0 ? (
        <LinkedUsage usage={usage} publishedBaseDomain={publishedBaseDomain} />
      ) : null}
      {design && design.length > 0 ? <DesignStrip items={design} /> : null}
      <CompareStage
        baselineSrc={
          hasBaseline[selected.id] ? snapshotImageUrl(project, build, selected, "baseline") : null
        }
        currentSrc={snapshotImageUrl(project, build, selected, "image")}
        diffSrc={selected.diffPath ? snapshotImageUrl(project, build, selected, "diff") : null}
        subject={`${selected.storyTitle} / ${selected.storyName}`}
        diffEmpty={diffEmptyText(selected.status)}
        diffMeta={percent ?? undefined}
      />
    </VStack>
  );
}
