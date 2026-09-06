import type { HtmlEscapedString } from "hono/utils/html";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import { Badge, statusTone } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Header + stats props for the diff review page. */
export interface DiffHeaderProps {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  pendingCount: number;
  canReview: boolean;
}

interface ReviewActionsProps {
  project: Project;
  build: Build;
  pendingCount: number;
}

/** Approve-all / reject-all bulk review actions. */
function ReviewActions(props: ReviewActionsProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, pendingCount } = props;
  return (
    <>
      <form
        method="post"
        action={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`}
        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/approve-all`}
        hx-target="body"
      >
        <button class="btn btn--primary" type="submit">
          Approve all ({pendingCount})
        </button>
      </form>
      <form
        method="post"
        action={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
        hx-target="body"
      >
        <button class="btn btn--danger" type="submit">
          Reject all
        </button>
      </form>
    </>
  );
}

interface DiffStatsProps {
  snapshots: Snapshot[];
  pendingCount: number;
  approvedCount: number;
}

/** Snapshot/pending/approved counters. */
function DiffStats(props: DiffStatsProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { snapshots, pendingCount, approvedCount } = props;
  return (
    <div class="card card--padded" style="margin-bottom:1rem;">
      <div class="grid grid--3" style="text-align:center;">
        <div class="stat">
          <div class="stat__value">{snapshots.length}</div>
          <div class="stat__label">Snapshots</div>
        </div>
        <div class="stat">
          <div class="stat__value" style="color: var(--status-new);">
            {pendingCount}
          </div>
          <div class="stat__label">Needs review</div>
        </div>
        <div class="stat">
          <div class="stat__value" style="color: var(--status-approved);">
            {approvedCount}
          </div>
          <div class="stat__label">Approved</div>
        </div>
      </div>
    </div>
  );
}

interface DiffBreadcrumbsProps {
  project: Project;
  build: Build;
}

/** Projects → project → build breadcrumb trail. */
function DiffBreadcrumbs(
  props: DiffBreadcrumbsProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build } = props;
  return (
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <a href="/projects">Projects</a>
        </li>
        <li>
          <a href={`/projects/${project.slug}/builds`}>{project.name}</a>
        </li>
        <li>
          <a href={`/projects/${project.slug}/builds/${build.id}`}>Build {build.gitBranch}</a>
        </li>
        <li>
          <span aria-current="page">Review</span>
        </li>
      </ol>
    </nav>
  );
}

/** Page header with breadcrumbs, review actions, and snapshot stats. */
export function DiffHeader(props: DiffHeaderProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, pendingCount, canReview } = props;
  return (
    <>
      <div class="page-header">
        <DiffBreadcrumbs project={project} build={build} />
        <div class="page-header__row">
          <div>
            <h1 class="page-header__title">
              {build.gitBranch}{" "}
              <span style="color:var(--text-secondary); font-weight:400;">
                · {build.gitSha.slice(0, 7)}
              </span>
            </h1>
            <p class="page-header__desc">
              {build.message ?? "No message"} {build.authorName ? `· ${build.authorName}` : ""} ·{" "}
              <Badge tone={statusTone(build.status)}>{build.status}</Badge>
            </p>
          </div>
          <div class="page-header__actions">
            <a class="btn btn--secondary" href={`/projects/${project.slug}/builds/${build.id}`}>
              Build overview
            </a>
            {canReview && pendingCount > 0 ? (
              <ReviewActions project={project} build={build} pendingCount={pendingCount} />
            ) : null}
          </div>
        </div>
      </div>
      <DiffStats
        snapshots={snapshots}
        pendingCount={pendingCount}
        approvedCount={build.approvedCount}
      />
    </>
  );
}
