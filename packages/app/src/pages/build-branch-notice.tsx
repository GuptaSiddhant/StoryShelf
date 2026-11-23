import type { Build, Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Alert, Button, Meta, VStack } from "../ui/components.tsx";

/** Props for the notice about a build whose default-branch claim did not count. */
export interface DefaultBranchNoticeProps {
  project: Pick<Project, "slug" | "gitDefaultBranch">;
  build: Pick<Build, "id" | "isDefault" | "branchVerified">;
  canReview: boolean;
}

/**
 * Why a build that names the default branch is not treated as one (ADR 0009, amendment
 * 2026-11-13), or that it counts unverified because the project turned verification off. Nothing
 * for a build that claims no default branch or whose claim the git host confirmed.
 */
export function DefaultBranchNotice(
  props: DefaultBranchNoticeProps,
): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { build, project } = props;
  const branch = project.gitDefaultBranch;
  const verification = build.branchVerified;
  if (verification === null || verification === undefined || verification === "verified") {
    return null;
  }
  switch (verification) {
    case "refused": {
      return (
        <ClaimNotRecognised {...props} title={`Commit is not on ${branch}`}>
          The git host says this commit is not on {branch}, so the build is reviewed like a
          feature-branch build: nothing was auto-approved and the {branch} baselines did not move.
        </ClaimNotRecognised>
      );
    }
    case "unreachable": {
      return (
        <ClaimNotRecognised {...props} title={`The git host could not confirm ${branch}`}>
          The git host did not answer whether this commit is on {branch}, so the build is reviewed
          like a feature-branch build until it does. Re-check once the host is reachable.
        </ClaimNotRecognised>
      );
    }
    default: {
      return build.isDefault ? (
        <Alert tone="info" title="Default branch not verified">
          No git channel can confirm this commit is on {branch}, and the project counts such builds
          as {branch} builds anyway (verification is off in the Tests settings).
        </Alert>
      ) : (
        <ClaimNotRecognised {...props} title="Default branch not verified">
          No git channel can confirm this commit is on {branch}, so the build is reviewed like a
          feature-branch build. Connect a GitHub or GitLab channel, or turn off verification in the
          project's Tests settings.
        </ClaimNotRecognised>
      );
    }
  }
}

/** The warning with a re-check, which captures the build again and asks the host again. */
function ClaimNotRecognised(
  props: DefaultBranchNoticeProps & { title: string; children?: unknown },
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, canReview, title, children } = props;
  const retry = `/api/v1/projects/${project.slug}/builds/${build.id}/retry`;
  return (
    <Alert tone="warning" title={title}>
      <VStack>
        <span>{children}</span>
        {canReview ? (
          <form method="post" action={retry} hx-post={retry} hx-target="body">
            <Button variant="secondary" size="sm" type="submit">
              Re-check and capture again
            </Button>
          </form>
        ) : null}
        <Meta>Re-checking asks the git host again and re-renders every story.</Meta>
      </VStack>
    </Alert>
  );
}
