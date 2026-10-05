import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Avatar, Badge, Button, Meta, Progress, statusTone } from "../ui/components.tsx";
import {
  headerActions,
  headerMain,
  headerMeta,
  headerProgress,
  headerSide,
  headerTitle,
  reviewHeader,
} from "../ui/styles/review-layout.ts";
import { reviewProgress } from "./build-diff-model.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Header props for the diff review page. */
export interface DiffHeaderProps {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  pendingCount: number;
  canReview: boolean;
}

interface BulkProps {
  project: Project;
  build: Build;
  pendingCount: number;
}

/** Approve-all / reject-all bulk actions (each asks for confirmation). */
function BulkActions({
  project,
  build,
  pendingCount,
}: BulkProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const base = `/api/v1/projects/${project.slug}/builds/${build.id}`;
  return (
    <>
      <form
        method="post"
        action={`${base}/approve-all`}
        hx-post={`${base}/approve-all`}
        hx-target="body"
        hx-confirm={`Approve all ${pendingCount} remaining changes?`}
        data-toast={`Approved ${pendingCount} ${pendingCount === 1 ? "change" : "changes"}`}
      >
        <Button variant="primary" size="sm" type="submit" icon="check">
          Approve all ({pendingCount})
        </Button>
      </form>
      <form
        method="post"
        action={`${base}/reject-all`}
        hx-post={`${base}/reject-all`}
        hx-target="body"
        hx-confirm={`Reject all ${pendingCount} remaining changes?`}
        data-toast={`Rejected ${pendingCount} ${pendingCount === 1 ? "change" : "changes"}`}
        data-toast-tone="warning"
      >
        <Button variant="secondary" size="sm" type="submit">
          Reject all
        </Button>
      </form>
    </>
  );
}

function HeaderTitle({ build }: { build: Build }): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <>
      <h1 class={headerTitle}>
        <span>{build.gitBranch}</span>
        <Meta as="span" mono>
          {build.gitSha.slice(0, 7)}
        </Meta>
        <Badge tone={statusTone(build.status)} icon>
          {build.status}
        </Badge>
      </h1>
      <p class={headerMeta}>
        {build.authorName ? <Avatar name={build.authorName} size="sm" /> : null}
        {build.authorName ? <span>{build.authorName}</span> : null}
        <span>{build.message ?? "No message"}</span>
      </p>
    </>
  );
}

function HeaderProgress({
  snapshots,
}: {
  snapshots: Snapshot[];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const progress = reviewProgress(snapshots);
  return (
    <div class={headerProgress}>
      <span>
        {progress.reviewable === 0
          ? "No changes to review"
          : `${progress.done} of ${progress.reviewable} reviewed`}
      </span>
      <Progress value={progress.done} max={progress.reviewable} label="Review progress" />
    </div>
  );
}

/** Compact build summary with review progress and bulk actions. */
export function DiffHeader(props: DiffHeaderProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, pendingCount, canReview } = props;
  return (
    <header class={reviewHeader}>
      <div class={headerMain}>
        <HeaderTitle build={build} />
      </div>
      <div class={headerSide}>
        <HeaderProgress snapshots={snapshots} />
        <div class={headerActions}>
          <Button
            variant="secondary"
            size="sm"
            href={`/projects/${project.slug}/builds/${build.id}`}
          >
            Build overview
          </Button>
          {canReview && pendingCount > 0 ? (
            <BulkActions project={project} build={build} pendingCount={pendingCount} />
          ) : null}
        </div>
      </div>
    </header>
  );
}
