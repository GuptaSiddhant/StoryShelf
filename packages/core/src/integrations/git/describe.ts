/** Human text for a build state and the comment marker shared by GitHub and GitLab. */
import type { NotifierState } from "../../adapters/notifier/index.ts";

/** Short description shown beside a commit status. */
export function describeState(state: NotifierState): string {
  switch (state) {
    case "pending": {
      return "Visual tests pending";
    }
    case "success": {
      return "Visual tests passed";
    }
    case "cancelled": {
      return "Cancelled";
    }
    default: {
      return "Visual changes detected or tests failed";
    }
  }
}

/** Hidden marker that keys the single comment per pull request and project (idempotent upsert). */
export function commentMarker(projectSlug: string): string {
  return `<!-- storyshelf:project=${projectSlug} -->`;
}

/** Hidden marker naming the build whose state the comment shows; ULIDs sort by creation. */
export function buildMarker(buildId: string): string {
  return `<!-- storyshelf:build=${buildId} -->`;
}

/** The build id a comment body names, or undefined for a comment without the marker. */
export function commentBuildId(body: string): string | undefined {
  return /<!-- storyshelf:build=([^\s]+) -->/u.exec(body)?.[1];
}

/**
 * The pre-0.x per-build marker (`<!-- storyshelf:<build url> -->`), still read for one release so a
 * pull request open across the upgrade adopts its comment (ADR 0053). Matches any build of the
 * same project: the url up to `/builds/`.
 */
export function legacyCommentPrefix(buildUrl: string): string {
  const at = buildUrl.lastIndexOf("/builds/");
  return `<!-- storyshelf:${at < 0 ? buildUrl : buildUrl.slice(0, at + "/builds/".length)}`;
}
