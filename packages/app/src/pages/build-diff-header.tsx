import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { CANCELLABLE_BUILD_STATUSES } from "@storyshelf/core/types";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import { getStore } from "../store.ts";
import {
  Button,
  Dropdown,
  DropdownItem,
  Icon,
  Meta,
  PageHeader,
  Progress,
  RelativeTime,
} from "../ui/components.tsx";
import { headerProgress } from "../ui/styles/review-layout.ts";
import type { BuildDetailsData } from "./build-detail.tsx";
import { reviewProgress } from "./build-diff-model.ts";
import { failureReason, isCapturing, isRetryable, statusView } from "./build-diff-status.ts";

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

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
}

function buildBase(project: Project, build: Build): string {
  return `/api/v1/projects/${project.slug}/builds/${build.id}`;
}

/** One post form around a header button: the action runs through its route class and CSRF. */
function ActionForm(props: {
  action: string;
  confirm?: string;
  toast?: string;
  toastTone?: string;
  children?: unknown;
}): Rendered {
  const { action, confirm, toast, toastTone, children } = props;
  return (
    <form
      method="post"
      action={action}
      hx-post={action}
      hx-target="body"
      hx-confirm={confirm}
      data-toast={toast}
      data-toast-tone={toastTone}
    >
      {children}
    </form>
  );
}

/** "Approve remaining 14": the one primary action while changes wait for a verdict. */
function ApproveRemaining(props: { project: Project; build: Build; count: number }): Rendered {
  const { project, build, count } = props;
  return (
    <ActionForm
      action={`${buildBase(project, build)}/approve-all`}
      confirm={`Approve all ${count} remaining changes?`}
      toast={`Approved ${count} ${count === 1 ? "change" : "changes"}`}
    >
      <Button variant="primary" size="sm" type="submit" icon="check">
        Approve remaining {count}
      </Button>
    </ActionForm>
  );
}

/** "Retry capture" as the primary action of a failed or cancelled build. */
function RetryButton(props: { project: Project; build: Build }): Rendered {
  return (
    <ActionForm action={`${buildBase(props.project, props.build)}/retry`}>
      <Button variant="primary" size="sm" type="submit">
        Retry capture
      </Button>
    </ActionForm>
  );
}

/** Branch, short sha, author and age: the strip's one metadata line. */
function HeaderMeta({ build }: { build: Build }): Rendered {
  return (
    <>
      <span>{build.gitBranch}</span>
      <Meta as="span" mono>
        {build.gitSha.slice(0, 7)}
      </Meta>
      {build.authorName ? <span>{build.authorName}</span> : null}
      <RelativeTime value={build.updatedAt} />
    </>
  );
}

/** The line under the status: review progress, capture progress or why capture failed. */
function HeaderDetail(props: DiffHeaderProps): Rendered | null {
  const { build, snapshots, details } = props;
  if (build.status === "failed") {
    return <span>{failureReason(details) ?? "No reason was recorded."}</span>;
  }
  if (isCapturing(build)) {
    const total = details?.stories;
    return <span>{total ? `Capturing… ${snapshots.length} of ${total}` : "Capturing…"}</span>;
  }
  const progress = reviewProgress(snapshots);
  if (details?.testing === false || progress.reviewable === 0) {
    return null;
  }
  return (
    <div class={headerProgress}>
      <span>
        {progress.done} of {progress.reviewable} reviewed
      </span>
      <Progress value={progress.done} max={progress.reviewable} label="Review progress" />
    </div>
  );
}

/** The ⋯ menu: Open Storybook, Reject all, Retry (when it is not the primary action) and Cancel. */
function MoreMenu(props: DiffHeaderProps & { showReject: boolean }): Rendered {
  const { project, build, canManage = false, details, pendingCount, showReject } = props;
  const base = buildBase(project, build);
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const manage = canManage && details?.testing !== false;
  return (
    <Dropdown
      label={<Icon name="more-horizontal" />}
      ariaLabel="More build actions"
      align="end"
      iconOnly
    >
      <DropdownItem href={urls.short(build.id)}>Open Storybook ↗</DropdownItem>
      {showReject ? (
        <ActionForm
          action={`${base}/reject-all`}
          confirm={`Reject all ${pendingCount} remaining changes?`}
          toast={`Rejected ${pendingCount} ${pendingCount === 1 ? "change" : "changes"}`}
          toastTone="warning"
        >
          <DropdownItem type="submit">Reject all</DropdownItem>
        </ActionForm>
      ) : null}
      {manage && !isRetryable(build) ? (
        <ActionForm action={`${base}/retry`}>
          <DropdownItem type="submit">Retry capture</DropdownItem>
        </ActionForm>
      ) : null}
      {manage && CANCELLABLE_BUILD_STATUSES.includes(build.status) ? (
        <ActionForm action={`${base}/cancel`}>
          <DropdownItem type="submit" icon="x-circle">
            Cancel build
          </DropdownItem>
        </ActionForm>
      ) : null}
    </Dropdown>
  );
}

/** The strip's actions: one primary button, then the menu (and "Show log" on a failed build). */
function HeaderActions(props: DiffHeaderProps): Rendered {
  const { project, build, pendingCount, canReview, canManage = false, details } = props;
  const testing = details?.testing ?? true;
  const showApprove = testing && canReview && project.reviewEnabled !== false && pendingCount > 0;
  return (
    <>
      {build.status === "failed" ? (
        <Button variant="ghost" size="sm" href="#build-details">
          Show log
        </Button>
      ) : null}
      {testing && canManage && isRetryable(build) ? (
        <RetryButton project={project} build={build} />
      ) : null}
      {showApprove ? (
        <ApproveRemaining project={project} build={build} count={pendingCount} />
      ) : null}
      <MoreMenu {...props} showReject={showApprove} />
    </>
  );
}

/** The build header as a status strip: status, where it came from, progress or reason, one action. */
export function DiffHeader(props: DiffHeaderProps): Rendered {
  const { build, details } = props;
  const view = statusView(build, details);
  return (
    <PageHeader
      title={view.label}
      status={{ tone: view.tone, icon: view.icon }}
      meta={<HeaderMeta build={build} />}
      detail={<HeaderDetail {...props} />}
      actions={<HeaderActions {...props} />}
    />
  );
}
