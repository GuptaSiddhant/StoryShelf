import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Button, PageHeader, statusTone } from "../ui/components.tsx";

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
        <Button variant="primary" size="sm" type="submit">
          Approve all ({pendingCount})
        </Button>
      </form>
      <form
        method="post"
        action={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
        hx-post={`/api/v1/projects/${project.slug}/builds/${build.id}/reject-all`}
        hx-target="body"
      >
        <Button variant="secondary" size="sm" type="submit">
          Reject all
        </Button>
      </form>
    </>
  );
}

/** Page header with breadcrumbs, review actions, and snapshot stats. */
export function DiffHeader(props: DiffHeaderProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, pendingCount, canReview } = props;
  return (
    <PageHeader
      title={
        <>
          {build.gitBranch}{" "}
          <span class="muted mono" style="font-weight:400;">
            · {build.gitSha.slice(0, 7)}
          </span>
        </>
      }
      description={
        <>
          {build.message ?? "No message"} {build.authorName ? `· ${build.authorName}` : ""} ·{" "}
          <Badge tone={statusTone(build.status)}>{build.status}</Badge>
        </>
      }
      meta={
        <>
          {snapshots.length} snapshots · {pendingCount} need review · {build.approvedCount} approved
        </>
      }
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            href={`/projects/${project.slug}/builds/${build.id}`}
          >
            Build overview
          </Button>
          {canReview && pendingCount > 0 ? (
            <ReviewActions project={project} build={build} pendingCount={pendingCount} />
          ) : null}
        </>
      }
      breadcrumbs={[
        { label: "Projects", href: "/projects" },
        { label: project.name, href: `/projects/${project.slug}/builds` },
        { label: `Build ${build.gitBranch}`, href: `/projects/${project.slug}/builds/${build.id}` },
        { label: "Review" },
      ]}
    />
  );
}
