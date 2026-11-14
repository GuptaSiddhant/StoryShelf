import type { Build, Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Button, EmptyState, HStack } from "../ui/components.tsx";
import type { BuildDetailsData } from "./build-detail.tsx";
import { failureReason, isCapturing } from "./build-diff-status.ts";

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** What the stage says, per status, when the build has no snapshots. */
export function emptyCopy(
  build: Build,
  details?: BuildDetailsData,
): { title: string; description: string } {
  if (build.status === "pending") {
    return { title: "Queued", description: "Waiting for a capture worker to pick this build up." };
  }
  if (isCapturing(build)) {
    return { title: "Capturing…", description: "Snapshots appear here as stories are rendered." };
  }
  if (build.status === "failed") {
    return {
      title: "Capture failed",
      description: failureReason(details) ?? "No reason was recorded for this failure.",
    };
  }
  if (build.status === "cancelled") {
    return {
      title: "Capture cancelled",
      description: "This build was cancelled before it produced any snapshots.",
    };
  }
  return details?.published
    ? {
        title: "Published without capture",
        description: "This build was uploaded without capture, so there is nothing to review.",
      }
    : { title: "No stories", description: "This Storybook has no stories to capture." };
}

/** The retry and log actions of a failed or cancelled build's empty state. */
function EmptyActions(props: {
  project: Project;
  build: Build;
  canManage: boolean;
}): Rendered | null {
  const { project, build, canManage } = props;
  const retry = `/api/v1/projects/${project.slug}/builds/${build.id}/retry`;
  const retryable = build.status === "failed" || build.status === "cancelled";
  if (!retryable) {
    return null;
  }
  return (
    <HStack justify="center">
      {canManage ? (
        <form method="post" action={retry} hx-post={retry} hx-target="body">
          <Button variant="primary" type="submit">
            Retry capture
          </Button>
        </form>
      ) : null}
      {build.status === "failed" ? (
        <Button variant="ghost" href="#build-details">
          Show log
        </Button>
      ) : null}
    </HStack>
  );
}

/** The stage's empty state for a build without snapshots, worded for the build's status. */
export function BuildEmptyState(props: {
  project: Project;
  build: Build;
  details?: BuildDetailsData;
  canManage?: boolean;
}): Rendered {
  const { project, build, details, canManage = false } = props;
  return (
    <EmptyState
      {...emptyCopy(build, details)}
      action={<EmptyActions project={project} build={build} canManage={canManage} />}
    />
  );
}
