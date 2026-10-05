import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, CompareStage, VStack, statusTone } from "../ui/components.tsx";
import { viewerHead, viewerMeta, viewerTitle } from "../ui/styles/review-layout.ts";
import { diffPercent, snapshotImageUrl } from "./build-diff-model.ts";
import { StaleSnapshotNotice } from "./build-diff-stale.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Viewer props for the selected snapshot. */
export interface DiffViewerProps {
  project: Project;
  build: Build;
  selected: Snapshot;
  hasBaseline: Record<string, boolean>;
  /** Set when the baseline changed after this snapshot's diff was computed. */
  drifted?: "stale" | "removed";
}

/** Why a snapshot has no diff image, phrased for the empty pane. */
function diffEmptyText(status: string): string {
  return status === "unchanged" || status === "approved"
    ? "No diff — within threshold"
    : "No diff yet";
}

/** Story heading plus the comparison stage for the selected snapshot. */
export function DiffViewer(props: DiffViewerProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, hasBaseline, drifted } = props;
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
            {selected.viewportName} · {selected.viewportWidth}×{selected.viewportHeight}
          </span>
          {selected.diffPixels === null || selected.diffPixels === undefined ? null : (
            <span class="mono">{selected.diffPixels} px</span>
          )}
          {percent ? <span class="mono">{percent}</span> : null}
        </p>
      </div>
      {drifted ? <StaleSnapshotNotice status={drifted} /> : null}
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
