import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert } from "../ui/components.tsx";
import { StaleBaselineNotice } from "./build-diff-stale.tsx";
import {
  environmentChangeOf,
  labelOf,
  summariseEnvironmentChanges,
  summarisePartlyUnknown,
} from "./environment-change.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/**
 * Build-level note: some snapshots were captured in a different environment than their baseline.
 * The default branch migrates them without a diff; a feature branch still diffs them (ADR 0005).
 */
export function EnvironmentChangeNotice(props: {
  snapshots: readonly Snapshot[];
  migrated: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const unknown = summarisePartlyUnknown(props.snapshots);
  const changed = <EnvironmentMigrationNotice {...props} />;
  return unknown ? (
    <>
      {changed}
      <PartlyUnknownNotice count={unknown.count} fields={unknown.fields} />
    </>
  ) : (
    changed
  );
}

/** The measurement version changed: some components were compared as unknown, not as different. */
function PartlyUnknownNotice(props: {
  count: number;
  fields: string[];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { count, fields } = props;
  return (
    <Alert tone="info" title="Environment partly unknown (measurement updated)">
      {count} {count === 1 ? "snapshot has" : "snapshots have"} a baseline whose environment was
      measured an older way, so the {fields.join(", ")} could not be compared. They are not treated
      as a change, and nothing was migrated because of them.
    </Alert>
  );
}

function EnvironmentMigrationNotice(props: {
  snapshots: readonly Snapshot[];
  migrated: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const summary = summariseEnvironmentChanges(props.snapshots);
  if (!summary) {
    return null;
  }
  const { count, fields, browserVersion } = summary;
  const what = `the ${fields.join(", ")} changed${
    browserVersion ? ` (${browserVersion.from} → ${browserVersion.to})` : ""
  }`;
  return props.migrated ? (
    <Alert tone="info" title="Capture environment changed">
      {count} {count === 1 ? "snapshot was" : "snapshots were"} accepted without a pixel diff
      because {what}. The same code renders differently here, so a diff would only show the
      environment. The baselines were updated to match.
    </Alert>
  ) : (
    <Alert tone="info" title="Capture environment changed">
      {count} {count === 1 ? "snapshot was" : "snapshots were"} compared against a baseline from a
      different capture environment: {what}. A difference may come from the environment rather than
      the code; once the default branch captures in the new environment, a rebuild compares like
      with like.
    </Alert>
  );
}

/** Per-snapshot note shown above the viewer for a snapshot whose capture environment changed. */
export function EnvironmentChangeSnapshotNotice(props: {
  snapshot: Pick<Snapshot, "envChange">;
  migrated: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const change = environmentChangeOf(props.snapshot);
  if (!change) {
    return null;
  }
  const unknown = (change.unknown ?? []).map((field) => labelOf(field));
  const note = unknown.length > 0 ? <PartlyUnknownNotice count={1} fields={unknown} /> : null;
  if (change.changed.length === 0) {
    return note;
  }
  const what = change.changed.map((field) => labelOf(field)).join(", ");
  return (
    <>
      {props.migrated ? (
        <Alert tone="info" title="No diff: capture environment changed">
          This snapshot was not compared pixel by pixel. What changed: {what}.
        </Alert>
      ) : (
        <Alert tone="info" title="Capture environment changed">
          The baseline was captured in a different environment ({what}), so a difference may come
          from the environment rather than the code.
        </Alert>
      )}
      {note}
    </>
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
      <EnvironmentChangeNotice snapshots={snapshots} migrated={build.isDefault} />
    </>
  );
}
