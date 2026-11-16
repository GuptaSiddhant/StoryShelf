import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert, Button, HStack, Meta, VStack } from "../ui/components.tsx";
/** Props for the build-level notice about diffs computed against an outdated baseline. */
export interface StaleBaselineNoticeProps {
  project: Project;
  build: Build;
  staleCount: number;
  canReview: boolean;
}

/**
 * Warns that undecided snapshots were compared with a baseline that has since changed.
 * Builds are never recaptured automatically, so the reviewer chooses how to refresh.
 */
export function StaleBaselineNotice(
  props: StaleBaselineNoticeProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, staleCount, canReview } = props;
  const base = `/api/v1/projects/${project.slug}/builds/${build.id}`;
  return (
    <Alert tone="warning" title="Baseline changed since this build was captured">
      <VStack>
        <span>
          {staleCount} undecided {staleCount === 1 ? "snapshot was" : "snapshots were"} compared
          against a baseline that has since changed, so {staleCount === 1 ? "its" : "their"} diff
          may be out of date. Builds are not recaptured automatically.
        </span>
        {canReview ? (
          <HStack>
            <form
              method="post"
              action={`${base}/rediff`}
              hx-post={`${base}/rediff`}
              hx-target="body"
            >
              <Button variant="primary" size="sm" type="submit">
                Re-diff against current baselines
              </Button>
            </form>
          </HStack>
        ) : null}
        <Meta>
          Re-diff reuses the stored screenshots and is quick. To re-render every story, use Retry
          capture in the ⋯ menu.
        </Meta>
      </VStack>
    </Alert>
  );
}

/** The header's one-line version: the same warning with the Re-diff action, no explanation. */
export function StaleBaselineLine(
  props: StaleBaselineNoticeProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, staleCount, canReview } = props;
  const url = `/api/v1/projects/${project.slug}/builds/${build.id}/rediff`;
  return (
    <Alert tone="warning">
      <HStack justify="between">
        <span>
          Baseline changed: {staleCount} {staleCount === 1 ? "diff is" : "diffs are"} out of date.
        </span>
        {canReview ? (
          <form method="post" action={url} hx-post={url} hx-target="body">
            <Button variant="primary" size="sm" type="submit">
              Re-diff
            </Button>
          </form>
        ) : null}
      </HStack>
    </Alert>
  );
}

/** Props for the per-snapshot notice shown above the three-up viewer. */
export interface StaleSnapshotNoticeProps {
  status: "stale" | "removed";
}

/** Explains why a single snapshot's diff can no longer be trusted. */
export function StaleSnapshotNotice(
  props: StaleSnapshotNoticeProps,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <Alert tone="warning" title="This diff is out of date">
      {props.status === "removed"
        ? "The baseline it was compared against no longer exists."
        : "The baseline changed after this diff was computed."}{" "}
      Re-diff the build before approving, or approve anyway to replace the current baseline with
      this screenshot.
    </Alert>
  );
}
