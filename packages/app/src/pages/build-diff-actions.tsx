import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button, Kbd, statusTone } from "../ui/components.tsx";
import { actionBar, actionGroup, actionHints, actionPosition } from "../ui/styles/review-layout.ts";
import { neighbours, snapshotPageUrl } from "./build-diff-model.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Sticky bottom bar props. */
export interface DiffActionBarProps {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  selected: Snapshot;
  canReview: boolean;
  drifted: boolean;
}

function snapshotBase(project: Project, build: Build, snapshot: Snapshot): string {
  return `/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snapshot.id}`;
}

type DecisionProps = { project: Project; build: Build; selected: Snapshot; drifted: boolean };

/** Approve (or "Approve anyway" when the baseline moved) as its own form. */
function ApproveForm(props: DecisionProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, drifted } = props;
  const url = `${snapshotBase(project, build, selected)}/approve${drifted ? "?force=true" : ""}`;
  return (
    <form
      method="post"
      action={url}
      hx-post={url}
      hx-target="body"
      data-toast={`Approved ${selected.storyName}`}
    >
      {drifted ? (
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
          title="Approve (a)"
        >
          Approve
        </Button>
      )}
    </form>
  );
}

/** Approve/reject for a reviewable snapshot; both advance to the next open one. */
function DecisionButtons(props: DecisionProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected } = props;
  const base = snapshotBase(project, build, selected);
  return (
    <div class={actionGroup}>
      <ApproveForm {...props} />
      <form
        method="post"
        action={`${base}/reject`}
        hx-post={`${base}/reject`}
        hx-target="body"
        data-toast={`Rejected ${selected.storyName}`}
        data-toast-tone="warning"
      >
        <Button variant="danger" size="sm" type="submit" icon="x" data-reject title="Reject (r)">
          Reject
        </Button>
      </form>
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

/** Previous/next stepping, position, shortcut hints, and the review decision. */
export function DiffActionBar(
  props: DiffActionBarProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, selected, canReview, drifted } = props;
  const around = neighbours(snapshots, selected.id);
  const reviewable = selected.status === "new" || selected.status === "changed";
  return (
    <div class={actionBar} role="toolbar" aria-label="Review actions">
      <div class={actionGroup}>
        <StepButton target={around.prev} project={project} build={build} direction="prev" />
        <span class={actionPosition} aria-live="polite">
          {around.position} / {around.total}
        </span>
        <StepButton target={around.next} project={project} build={build} direction="next" />
      </div>
      <div class={actionHints}>
        <Kbd keys={["j", "k"]} /> navigate <Kbd keys="a" /> approve <Kbd keys="r" /> reject
        <Button variant="ghost" size="sm" data-shortcuts-open aria-label="Keyboard shortcuts (?)">
          <Kbd keys="?" />
        </Button>
      </div>
      {canReview && reviewable ? (
        <DecisionButtons project={project} build={build} selected={selected} drifted={drifted} />
      ) : (
        <Badge tone={statusTone(selected.status)} icon>
          {selected.status}
        </Badge>
      )}
    </div>
  );
}
