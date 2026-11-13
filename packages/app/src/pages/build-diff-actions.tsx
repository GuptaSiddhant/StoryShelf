import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button, Kbd, statusTone } from "../ui/components.tsx";
import {
  actionBar,
  actionGroup,
  actionHints,
  actionKey,
  actionPosition,
} from "../ui/styles/review-layout.ts";
import {
  REVIEW_CANVAS_ID,
  groupOf,
  neighbours,
  snapshotPageUrl,
  type SnapshotGroup,
} from "./build-diff-model.ts";
/** Sticky bottom bar props. */
export interface DiffActionBarProps {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  selected: Snapshot;
  canReview: boolean;
  /** Open snapshots whose baseline changed after their diff was computed. */
  drifted: Record<string, "stale" | "removed">;
}

/** What one decision covers: a whole story/mode across browsers, or a single snapshot. */
interface DecisionTarget {
  /** Endpoint prefix; `/approve` and `/reject` are appended. */
  base: string;
  /** True when the decision applies to every open browser of the story/mode. */
  shared: boolean;
  drifted: boolean;
  label: string;
}

/**
 * Approve and reject swap the review canvas in place: the server answers with the next snapshot
 * (and the header and filmstrip out of band), or redirects when the baseline moved.
 */
const CANVAS = `#${REVIEW_CANVAS_ID}`;

function apiBase(project: Project, build: Build): string {
  return `/api/v1/projects/${project.slug}/builds/${build.id}`;
}

const isOpenStatus = (snap: Snapshot): boolean =>
  snap.status === "new" || snap.status === "changed";

function sharedTarget(
  base: string,
  group: SnapshotGroup,
  open: Snapshot[],
  name: string,
): Pick<DecisionTarget, "base" | "shared" | "label"> {
  const story = encodeURIComponent(group.storyId);
  const mode = encodeURIComponent(group.modeKey);
  return {
    base: `${base}/stories/${story}/modes/${mode}`,
    shared: true,
    label: `${name} (${open.length} browsers)`,
  };
}

function decisionTarget(props: DiffActionBarProps): DecisionTarget | null {
  const { project, build, snapshots, selected, drifted } = props;
  const group = groupOf(snapshots, selected.id);
  const open = (group?.members ?? [selected]).filter((snap) => isOpenStatus(snap));
  const [first] = open;
  if (!first) return null;
  const base = apiBase(project, build);
  const drift = { drifted: open.some((snap) => drifted[snap.id] !== undefined) };
  if (open.length > 1 && group) {
    return { ...sharedTarget(base, group, open, selected.storyName), ...drift };
  }
  return { base: `${base}/snapshots/${first.id}`, shared: false, label: first.storyName, ...drift };
}

/** The key that triggers a button, shown inside it; hidden from assistive tech (`aria-keyshortcuts` says it). */
function KeyHint(props: { keys: string }): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <span class={actionKey} aria-hidden="true">
      <Kbd keys={props.keys} />
    </span>
  );
}

/** Approve (or "Approve anyway" when a baseline moved) as its own form. */
function ApproveForm(props: {
  target: DecisionTarget;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { target } = props;
  const url = `${target.base}/approve${target.drifted ? "?force=true" : ""}`;
  return (
    <form
      method="post"
      action={url}
      hx-post={url}
      hx-target={CANVAS}
      hx-swap="outerHTML"
      data-toast={`Approved ${target.label}`}
    >
      {target.drifted ? (
        <Button
          variant="secondary"
          size="sm"
          type="submit"
          icon="check"
          title="The baseline changed after this diff; replace it with this screenshot"
        >
          Approve anyway
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          type="submit"
          icon="check"
          data-approve
          aria-keyshortcuts="a"
          title={target.shared ? "Approve every browser (a)" : "Approve (a)"}
        >
          {target.shared ? "Approve all browsers" : "Approve"} <KeyHint keys="a" />
        </Button>
      )}
    </form>
  );
}

/** Per-snapshot escape hatch: approve only the browser being viewed. */
function ApproveOnlyThisForm(props: {
  project: Project;
  build: Build;
  selected: Snapshot;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected } = props;
  const url = `${apiBase(project, build)}/snapshots/${selected.id}/approve`;
  return (
    <form
      method="post"
      action={url}
      hx-post={url}
      hx-target={CANVAS}
      hx-swap="outerHTML"
      data-toast={`Approved ${selected.storyName} on ${selected.browser ?? "chromium"}`}
    >
      <Button variant="ghost" size="sm" type="submit" title="Approve only this browser">
        Only {selected.browser ?? "chromium"}
      </Button>
    </form>
  );
}

/** Reject: secondary weight with danger text, so Approve stays the one filled button. */
function RejectForm(props: {
  target: DecisionTarget;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { target } = props;
  return (
    <form
      method="post"
      action={`${target.base}/reject`}
      hx-post={`${target.base}/reject`}
      hx-target={CANVAS}
      hx-swap="outerHTML"
      data-toast={`Rejected ${target.label}`}
      data-toast-tone="warning"
    >
      <Button
        variant="danger-secondary"
        size="sm"
        type="submit"
        icon="x"
        data-reject
        aria-keyshortcuts="r"
        title="Reject (r)"
      >
        Reject <KeyHint keys="r" />
      </Button>
    </form>
  );
}

/** Approve/reject for a reviewable story/mode; both advance to the next open one. */
function DecisionButtons(props: {
  project: Project;
  build: Build;
  selected: Snapshot;
  target: DecisionTarget;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, target } = props;
  const selectedOpen = selected.status === "new" || selected.status === "changed";
  return (
    <div class={actionGroup}>
      <RejectForm target={target} />
      {target.shared && selectedOpen ? (
        <ApproveOnlyThisForm project={project} build={build} selected={selected} />
      ) : null}
      <ApproveForm target={target} />
    </div>
  );
}

function StepButton(props: {
  target: Snapshot | null;
  project: Project;
  build: Build;
  direction: "prev" | "next";
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { target, project, build, direction } = props;
  const label = direction === "prev" ? "Previous snapshot (k)" : "Next snapshot (j)";
  const icon = direction === "prev" ? "chevron-left" : "chevron-right";
  if (!target) {
    return <Button variant="ghost" size="sm" icon={icon} disabled aria-label={label} />;
  }
  const url = snapshotPageUrl(project, build, target.id);
  const hook = direction === "prev" ? { "data-snap-prev": true } : { "data-snap-next": true };
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={icon}
      href={url}
      aria-label={label}
      title={label}
      hx-get={url}
      hx-target="body"
      hx-push-url="true"
      {...hook}
    />
  );
}

/** The comparison card's footer: previous/next stepping, the review decision, and keyboard help. */
export function DiffActionBar(
  props: DiffActionBarProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, selected, canReview } = props;
  const around = neighbours(snapshots, selected.id);
  const target = decisionTarget(props);
  return (
    <div class={actionBar} data-action-bar role="toolbar" aria-label="Review actions">
      <div class={actionGroup}>
        <StepButton target={around.prev} project={project} build={build} direction="prev" />
        <span class={actionPosition} aria-live="polite">
          {around.position} / {around.total}
        </span>
        <StepButton target={around.next} project={project} build={build} direction="next" />
      </div>
      {canReview && target ? (
        <DecisionButtons project={project} build={build} selected={selected} target={target} />
      ) : (
        <Badge tone={statusTone(selected.status)} icon>
          {selected.status}
        </Badge>
      )}
      <div class={actionHints}>
        <Button variant="ghost" size="sm" data-shortcuts-open aria-label="Keyboard shortcuts (?)">
          <Kbd keys="?" />
        </Button>
      </div>
    </div>
  );
}
