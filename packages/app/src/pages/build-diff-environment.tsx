import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert } from "../ui/components.tsx";
import { StaleBaselineNotice } from "./build-diff-stale.tsx";
import { environmentChangeOf, labelOf, summariseEnvironmentChanges } from "./environment-change.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Build-level note: some snapshots were accepted without a diff because the capture environment changed. */
export function EnvironmentChangeNotice(props: {
  snapshots: readonly Snapshot[];
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const summary = summariseEnvironmentChanges(props.snapshots);
  if (!summary) {
    return null;
  }
  const { count, fields, browserVersion } = summary;
  return (
    <Alert tone="info" title="Capture environment changed">
      {count} {count === 1 ? "snapshot was" : "snapshots were"} accepted without a pixel diff
      because the {fields.join(", ")} changed
      {browserVersion ? ` (${browserVersion.from} → ${browserVersion.to})` : ""}. The same code
      renders differently here, so a diff would only show the environment. On the default branch the
      baselines were updated to match.
    </Alert>
  );
}

/** Per-snapshot note shown above the viewer for a snapshot accepted as an environment migration. */
export function EnvironmentChangeSnapshotNotice(props: {
  snapshot: Pick<Snapshot, "envChange">;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const change = environmentChangeOf(props.snapshot);
  if (!change) {
    return null;
  }
  return (
    <Alert tone="info" title="No diff: capture environment changed">
      This snapshot was not compared pixel by pixel. What changed:{" "}
      {change.changed.map(labelOf).join(", ")}.
    </Alert>
  );
}

/** Build-level notices above the review grid: stale baselines and environment migrations. */
export function ReviewNotices(props: {
  project: Project;
  build: Build;
  snapshots: readonly Snapshot[];
  drifted: Record<string, unknown>;
  canReview: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, drifted, canReview } = props;
  const staleCount = Object.keys(drifted).length;
  return (
    <>
      {staleCount > 0 ? (
        <StaleBaselineNotice
          project={project}
          build={build}
          staleCount={staleCount}
          canReview={canReview}
        />
      ) : null}
      <EnvironmentChangeNotice snapshots={snapshots} />
    </>
  );
}
