import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { CANCELLABLE_BUILD_STATUSES } from "@storyshelf/core/types";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import { getStore } from "../store.ts";
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Icon,
  DropdownItem,
  Meta,
  Progress,
  statusTone,
} from "../ui/components.tsx";
import {
  headerActions,
  headerMain,
  headerMeta,
  headerProgress,
  headerSide,
  headerTitle,
  reviewHeader,
} from "../ui/styles/review-layout.ts";
import { a11ySummaryOf, a11yUnavailableNote } from "./a11y-violations.tsx";
import type { BuildDetailsData } from "./build-detail.tsx";
import { reviewProgress } from "./build-diff-model.ts";
/** Header props for the build page. */
export interface DiffHeaderProps {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  pendingCount: number;
  canReview: boolean;
  /** Whether the viewer may retry or cancel the build (developer role and above). */
  canManage?: boolean;
  /** Loaded build details; without them the header assumes capture is on. */
  details?: BuildDetailsData;
  /** Mark the header for an out-of-band swap (the in-place answer to approve and reject). */
  oob?: boolean;
}

interface BulkProps {
  project: Project;
  build: Build;
  pendingCount: number;
}

/** The one summary line: "3 to review · 11 snapshots · 4 inherited · 0 a11y findings". */
export function summaryLine(
  build: Build,
  snapshots: Snapshot[],
  details: BuildDetailsData | undefined,
): string {
  if (details && !details.testing) {
    const parts: string[] = [];
    if (details.components !== null) {
      parts.push(`${details.components} ${details.components === 1 ? "component" : "components"}`);
    }
    if (details.stories !== null) {
      parts.push(`${details.stories} ${details.stories === 1 ? "story" : "stories"}`);
    }
    return parts.join(" · ");
  }
  const findings = a11ySummaryOf(snapshots).findings;
  return [
    `${reviewProgress(snapshots).pending} to review`,
    `${snapshots.length} ${snapshots.length === 1 ? "snapshot" : "snapshots"}`,
    `${build.inheritedCount} inherited`,
    `${findings} a11y ${findings === 1 ? "finding" : "findings"}`,
  ].join(" · ");
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

function HeaderTitle(props: DiffHeaderProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { build, snapshots, details } = props;
  const a11y = a11ySummaryOf(snapshots);
  const label = details?.published ? "Published" : build.status;
  return (
    <>
      <h1 class={headerTitle}>
        <span>{build.gitBranch}</span>
        <Meta as="span" mono>
          {build.gitSha.slice(0, 7)}
        </Meta>
        <Badge tone={statusTone(build.status)} icon>
          {label}
        </Badge>
      </h1>
      <p class={headerMeta}>
        {build.authorName ? <Avatar name={build.authorName} size="sm" /> : null}
        {build.authorName ? <span>{build.authorName}</span> : null}
        <span>{build.message ?? "No message"}</span>
      </p>
      <p class={headerMeta}>
        <span>{summaryLine(build, snapshots, details)}</span>
        {a11y.fromBaseline > 0 ? (
          <Badge tone="neutral">a11y {a11y.fromBaseline} from baseline (not measured here)</Badge>
        ) : null}
        {a11y.unavailable > 0 ? (
          <Badge tone="neutral">{a11yUnavailableNote(a11y.unavailable)}</Badge>
        ) : null}
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

/** The ⋯ menu: Retry capture (once, here) and Cancel build while it can still be cancelled. */
function MoreMenu(props: {
  project: Project;
  build: Build;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build } = props;
  const base = `/api/v1/projects/${project.slug}/builds/${build.id}`;
  return (
    <Dropdown
      label={<Icon name="more-horizontal" />}
      ariaLabel="More build actions"
      align="end"
      iconOnly
    >
      <form method="post" action={`${base}/retry`} hx-post={`${base}/retry`} hx-target="body">
        <DropdownItem type="submit">Retry capture</DropdownItem>
      </form>
      {CANCELLABLE_BUILD_STATUSES.includes(build.status) ? (
        <form method="post" action={`${base}/cancel`} hx-post={`${base}/cancel`} hx-target="body">
          <DropdownItem type="submit" icon="x-circle">
            Cancel build
          </DropdownItem>
        </form>
      ) : null}
    </Dropdown>
  );
}

/** Branch, status, author, summary and the build's actions. */
export function DiffHeader(props: DiffHeaderProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, pendingCount, canReview, canManage = false, details } = props;
  const testing = details?.testing ?? true;
  const reviewOn = project.reviewEnabled !== false;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <header class={reviewHeader} id="review-header" hx-swap-oob={props.oob ? "true" : undefined}>
      <div class={headerMain}>
        <HeaderTitle {...props} />
      </div>
      <div class={headerSide}>
        {testing ? <HeaderProgress snapshots={snapshots} /> : null}
        <div class={headerActions}>
          {testing && reviewOn && canReview && pendingCount > 0 ? (
            <BulkActions project={project} build={build} pendingCount={pendingCount} />
          ) : null}
          <Button variant="secondary" size="sm" href={urls.short(build.id)}>
            Open Storybook ↗
          </Button>
          {testing && canManage ? <MoreMenu project={project} build={build} /> : null}
        </div>
      </div>
    </header>
  );
}
